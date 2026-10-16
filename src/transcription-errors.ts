export function transcriptionError(error: string, online = true) {
  if (/429|too many requests|rate.?limit/i.test(error))
    return 'Hugging Face begrenzt gerade die Modelldownloads. Bitte versuche es später erneut. Deine Aufnahme bleibt gespeichert.';
  if (/out of memory|allocation|memory access|cannot enlarge|not enough memory/i.test(error))
    return 'Der Arbeitsspeicher reicht für diese Aufnahme nicht aus. Versuche eine kürzere Aufnahme oder ein leistungsfähigeres Gerät. Deine Originalaufnahme bleibt erhalten.';
  if (!online && /fetch|network|download/i.test(error))
    return 'Für diese Transkription fehlen noch Modelldateien im Offline-Speicher. Verbinde dich zum vollständigen Download mit dem Internet und versuche es erneut.';
  if (/401|403|forbidden|unauthorized/i.test(error))
    return 'Der Zugriff auf das Sprachmodell wurde verweigert. Prüfe, ob dein Netzwerk Hugging Face und dessen CDN erlaubt. Deine Aufnahme bleibt gespeichert.';
  if (/404|not found/i.test(error))
    return 'Eine benötigte Modelldatei ist beim Anbieter nicht verfügbar. Bitte versuche es später erneut. Deine Aufnahme bleibt gespeichert.';
  if (/fetch|network|download/i.test(error))
    return 'Das Sprachmodell konnte nicht vollständig geladen werden. Prüfe die Verbindung und versuche es erneut. Deine Aufnahme bleibt gespeichert.';
  return 'Die Spracherkennung ist auf diesem Gerät fehlgeschlagen. Versuche eine kürzere Aufnahme oder einen aktuellen Browser. Deine Originalaufnahme bleibt erhalten.';
}
