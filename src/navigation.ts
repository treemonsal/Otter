import { useEffect, useRef, useState, type MutableRefObject } from 'react';
export type Page = 'home' | 'all' | 'starred' | 'folders' | 'tasks' | 'trash' | 'settings';
export type Tab = 'transcript' | 'summary' | 'tasks' | 'notes' | 'ask';
export interface Route {
  page: Page;
  selected: string | null;
  tab: Tab;
}
const pages = ['home', 'all', 'starred', 'folders', 'tasks', 'trash', 'settings'];
const tabs = ['transcript', 'summary', 'tasks', 'notes', 'ask'];
function read(): Route {
  const [path, query] = location.hash.slice(2).split('?');
  const parts = (path || 'home').split('/');
  const from = new URLSearchParams(query).get('from');
  return {
    page: (parts[0] === 'meeting'
      ? pages.includes(from || '')
        ? from
        : 'all'
      : pages.includes(parts[0])
        ? parts[0]
        : 'home') as Page,
    selected: parts[0] === 'meeting' && /^[\w-]{1,100}$/.test(parts[1] || '') ? parts[1] : null,
    tab: (tabs.includes(parts[2]) ? parts[2] : 'transcript') as Tab,
  };
}
function hash(route: Route) {
  return route.selected
    ? `#/meeting/${route.selected}/${route.tab}?from=${route.page}`
    : `#/${route.page}`;
}
export function useNavigation(guard: MutableRefObject<() => boolean>) {
  const [route, setRoute] = useState<Route>(read);
  const current = useRef(route);
  const position = useRef(history.state?.murmurIndex || 0);
  useEffect(() => {
    history.replaceState(
      { ...history.state, murmurIndex: history.state?.murmurIndex || 0 },
      '',
      hash(current.current),
    );
    const receive = () => {
      const next = read();
      const nextIndex = history.state?.murmurIndex ?? position.current;
      if (hash(next) === hash(current.current)) {
        position.current = nextIndex;
        return;
      }
      if (!guard.current()) {
        const distance = position.current - nextIndex;
        if (distance) history.go(distance);
        else history.replaceState({ murmurIndex: position.current }, '', hash(current.current));
        return;
      }
      position.current = nextIndex;
      current.current = next;
      setRoute(next);
    };
    addEventListener('popstate', receive);
    addEventListener('hashchange', receive);
    return () => {
      removeEventListener('popstate', receive);
      removeEventListener('hashchange', receive);
    };
  }, [guard]);
  function go(value: Route | ((old: Route) => Route), replace = false) {
    const next = typeof value === 'function' ? value(current.current) : value;
    if (hash(next) === hash(current.current)) return;
    const index = (history.state?.murmurIndex || 0) + (replace ? 0 : 1);
    history[replace ? 'replaceState' : 'pushState']({ murmurIndex: index }, '', hash(next));
    position.current = index;
    current.current = next;
    setRoute(next);
  }
  function close() {
    if (history.state?.murmurIndex > 0) history.back();
    else go({ ...current.current, selected: null }, true);
  }
  return { route, go, close };
}
