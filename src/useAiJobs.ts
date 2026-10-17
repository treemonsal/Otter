import { useEffect, useRef, useState } from 'react';
import {
  allJobs,
  claimJob,
  deleteJob,
  renewJob,
  runServiceJob,
  saveJob,
  serviceRequest,
  type AiJob,
} from './ai-service';
import { subscribeChanges } from './db';
import type { Meeting } from './types';
export function useAiJobs() {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const active = useRef<{ controller: AbortController; job: AiJob } | null>(null);
  const owner = useRef(crypto.randomUUID());
  const alive = useRef(true);
  const publish = (job: AiJob) => {
    if (alive.current) setJobs((old) => [...old.filter((x) => x.id !== job.id), job]);
  };
  useEffect(() => {
    alive.current = true;
    const refresh = () => {
      void allJobs()
        .then((next) => {
          if (alive.current) setJobs(next);
        })
        .catch(() => {});
    };
    refresh();
    const unsubscribe = subscribeChanges(refresh);
    return () => {
      alive.current = false;
      unsubscribe();
      active.current?.controller.abort();
    };
  }, []);
  async function execute(candidate: AiJob, meeting: Meeting, progress: (message: string) => void) {
    if (active.current) throw new Error('Es läuft bereits eine KI-Verarbeitung.');
    const work = async (ownsLock: boolean) => {
      let job = await claimJob(candidate, owner.current, ownsLock);
      const controller = new AbortController();
      active.current = { controller, job };
      const heartbeat = setInterval(
        () => void renewJob(job.id, owner.current).catch(() => controller.abort()),
        5000,
      );
      try {
        const result = await runServiceJob(job, meeting, controller.signal, async (next) => {
          job = await saveJob(next, owner.current);
          active.current = { controller, job };
          publish(job);
          progress(job.message);
        });
        return result;
      } catch (error) {
        job = {
          ...job,
          status: 'paused',
          message: controller.signal.aborted
            ? 'Pausiert · Zwischenstand gespeichert'
            : error instanceof Error
              ? error.message
              : 'Verarbeitung unterbrochen. Du kannst fortsetzen.',
        };
        if (!controller.signal.aborted) throw error;
        return null;
      } finally {
        clearInterval(heartbeat);
        try {
          job = await saveJob(job, owner.current, true);
          publish(job);
        } catch {
          /* Another window owns the current checkpoint. */
        }
        active.current = null;
      }
    };
    if (navigator.locks)
      return navigator.locks.request(
        `murmur-job:${candidate.id}`,
        { ifAvailable: true },
        (lock) => {
          if (!lock) throw new Error('Dieser Auftrag läuft bereits in einem anderen Fenster.');
          return work(true);
        },
      );
    return work(false);
  }
  function pause() {
    const running = active.current;
    if (!running) return;
    running.controller.abort();
    if (running.job.remoteId)
      void serviceRequest(
        running.job.endpoint,
        `/v1/jobs/${running.job.remoteId}/pause`,
        undefined,
        { method: 'POST' },
      ).catch(() => {});
  }
  async function discard(job: AiJob) {
    if (active.current?.job.id === job.id) throw new Error('Bitte pausiere den Auftrag zuerst.');
    // Acquire ownership before deleting; another tab may still be working.
    const remove = async (ownsLock: boolean) => {
      await claimJob(job, owner.current, ownsLock);
      await deleteJob(job.id);
      setJobs((old) => old.filter((x) => x.id !== job.id));
    };
    if (navigator.locks)
      await navigator.locks.request(`murmur-job:${job.id}`, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('Dieser Auftrag läuft in einem anderen Fenster.');
        await remove(true);
      });
    else await remove(false);
    if (job.remoteId)
      void serviceRequest(job.endpoint, `/v1/jobs/${job.remoteId}`, undefined, {
        method: 'DELETE',
      }).catch(() => {});
  }
  return { jobs, execute, pause, discard };
}
