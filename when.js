/* Comeback time parsing: no AI, runs on the device.
   "meeting with Sarah 3pm" -> { title: 'Meeting with Sarah', dueAt: <today 15:00>, hasTime: true, kind: 'event' }
   "finish lab report by friday" -> { title: 'Finish lab report', dueAt: <friday 23:59>, hasTime: false, kind: 'task' } */
(function (root) {
  'use strict';
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const DAY_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
  const EVENT_RE = /\b(meet(ing)?|call|appointment|appt|class|lecture|lab section|interview|session|dentist|doctor|office hours|standup|sync|zoom|teams|1:1|one on one|dinner|lunch with|flight|shift|practice|recitation)\b/i;

  function parseWhen(input, now = new Date()) {
    let text = ` ${String(input || '')} `;
    let day = null; let dayOnly = false; let hour = null; let minute = 0;
    const take = re => { const m = text.match(re); if (m) text = text.replace(m[0], ' '); return m; };

    // time: "3pm", "3:30 pm", "at 3", "at 15:00", "15:30"
    let m = take(/\s(?:at|@)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=[\s,.!?]|$)/i);
    if (m) {
      hour = +m[1] % 12; minute = +(m[2] || 0);
      if (/^p/i.test(m[3])) hour += 12;
    } else if ((m = take(/\s(?:at|@)\s*(\d{1,2})(?::(\d{2}))?(?=[\s,.!?]|$)/i))) {
      hour = +m[1]; minute = +(m[2] || 0);
      if (hour >= 1 && hour <= 7) hour += 12; // "at 3" almost always means 3 PM
    } else if ((m = take(/\s([01]?\d|2[0-3]):([0-5]\d)(?=[\s,.!?]|$)/))) {
      hour = +m[1]; minute = +m[2];
    } else if ((m = take(/\s(noon|midday)(?=[\s,.!?]|$)/i))) { hour = 12; }
    if (hour !== null && (hour > 23 || minute > 59)) { hour = null; minute = 0; }

    // day
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const by = !!take(/\s(by|before|due)(?=\s+(today|tonight|tomorrow|tmrw?|tmr|this|next|sun|mon|tue|wed|thu|fri|sat))/i);
    if ((m = take(/\s(today|tonight|this evening)(?=[\s,.!?]|$)/i))) {
      day = new Date(base); if (/night|evening/i.test(m[1]) && hour === null) hour = 20;
    } else if (take(/\s(tomorrow|tmrw?|tmr)(?=[\s,.!?]|$)/i)) {
      day = new Date(base); day.setDate(day.getDate() + 1);
    } else if ((m = take(new RegExp(`\\s(?:on\\s+|this\\s+|next\\s+)?${DAY_RE}(?=[\\s,.!?]|$)`, 'i')))) {
      const key = m[1].toLowerCase().slice(0, 3);
      const target = DAYS.findIndex(d => d.startsWith(key));
      day = new Date(base);
      let diff = (target - base.getDay() + 7) % 7;
      if (/next\s/i.test(m[0]) && diff === 0) diff = 7;
      day.setDate(day.getDate() + diff);
    }

    let dueAt = null;
    if (hour !== null) {
      const d = day ? new Date(day) : new Date(base);
      d.setHours(hour, minute, 0, 0);
      // a bare time that already passed more than an hour ago means tomorrow
      if (!day && d.getTime() < now.getTime() - 3600000) d.setDate(d.getDate() + 1);
      dueAt = d.getTime();
    } else if (day) {
      const d = new Date(day); d.setHours(23, 59, 0, 0); dueAt = d.getTime(); dayOnly = true;
    }

    let title = text.replace(/\s+/g, ' ').trim()
      .replace(/\s+(at|on|by|for|this|next|before|due|@)$/i, '')
      .replace(/^(at|on|by)\s+/i, '')
      .replace(/[,\s]+$/, '');
    if (!title) title = String(input || '').trim();
    title = title.charAt(0).toUpperCase() + title.slice(1);
    const hasTime = hour !== null;
    const kind = hasTime && EVENT_RE.test(title) ? 'event' : 'task';
    return { title: title.slice(0, 80), dueAt, hasTime, dayOnly, kind, by };
  }

  function formatWhen(ts, now = new Date(), dayOnly = false) {
    if (!ts) return '';
    const d = new Date(ts);
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - base) / 86400000);
    const dayLabel = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : dayDiff === -1 ? 'Yesterday'
      : dayDiff > 1 && dayDiff < 7 ? d.toLocaleDateString([], { weekday: 'short' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    if (dayOnly) return dayLabel;
    return `${dayLabel} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }

  const api = { parseWhen, formatWhen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ComebackWhen = api;
})(typeof window !== 'undefined' ? window : globalThis);
