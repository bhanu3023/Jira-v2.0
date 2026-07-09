'use client';

import { useEffect, useState, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store';
import { typeIcons, priorityColors } from '@/lib/utils';
import IssueTypeIcon from '@/components/ui/IssueTypeIcon';
import { ChevronLeft, ChevronRight, Calendar as CalIcon } from 'lucide-react';
import Link from 'next/link';
import { startOfMonth, endOfMonth, eachDayOfInterval, format, addMonths, subMonths, isSameMonth, isToday, isSameDay } from 'date-fns';

export default function CalendarPage() {
  const { issues, loadIssues, spaces } = useStore(
    useShallow((s) => ({
      issues: s.issues,
      loadIssues: s.loadIssues,
      spaces: s.spaces,
    })),
  );
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedSpace, setSelectedSpace] = useState('');

  useEffect(() => {
    loadIssues(selectedSpace ? { spaceKey: selectedSpace } : {});
  }, [loadIssues, selectedSpace]);

  const days = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const allDays = eachDayOfInterval({ start, end });

    // Pad start to Monday
    const startDay = start.getDay();
    const padStart = startDay === 0 ? 6 : startDay - 1;
    for (let i = 0; i < padStart; i++) {
      allDays.unshift(new Date(start.getTime() - (padStart - i) * 86400000));
    }
    // Pad end to fill grid
    while (allDays.length % 7 !== 0) {
      allDays.push(new Date(end.getTime() + (allDays.length % 7) * 86400000));
    }
    return allDays;
  }, [currentMonth]);

  const getIssuesForDay = (day: Date) =>
    issues.filter(i => i.dueDate && isSameDay(new Date(i.dueDate), day));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><CalIcon size={24} /> Calendar</h1>
        <div className="flex items-center gap-3">
          <select value={selectedSpace} onChange={e => setSelectedSpace(e.target.value)} className="input-field w-48">
            <option value="">All Spaces</option>
            {spaces.map(s => <option key={s.id} value={s.key}>{s.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <button onClick={() => setCurrentMonth(m => subMonths(m, 1))} className="p-1.5 hover:bg-gray-100 rounded"><ChevronLeft size={18} /></button>
            <span className="font-semibold text-lg w-40 text-center">{format(currentMonth, 'MMMM yyyy')}</span>
            <button onClick={() => setCurrentMonth(m => addMonths(m, 1))} className="p-1.5 hover:bg-gray-100 rounded"><ChevronRight size={18} /></button>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {/* Day Headers */}
        <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
            <div key={day} className="px-2 py-2 text-xs font-medium text-gray-500 text-center">{day}</div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const dayIssues = getIssuesForDay(day);
            const isCurrentMonth = isSameMonth(day, currentMonth);
            return (
              <div key={i} className={`min-h-[100px] border-b border-r border-gray-100 p-1 ${!isCurrentMonth ? 'bg-gray-50' : ''}`}>
                <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday(day) ? 'bg-blue-600 text-white' : isCurrentMonth ? 'text-gray-700' : 'text-gray-400'}`}>
                  {format(day, 'd')}
                </div>
                <div className="space-y-0.5">
                  {dayIssues.slice(0, 3).map(issue => (
                    <Link key={issue.id} href={`/issues/${issue.cfKey ?? issue.key}`}
                      className="block text-[10px] px-1.5 py-0.5 rounded truncate hover:opacity-80"
                      style={{ backgroundColor: priorityColors[issue.priority] + '20', color: priorityColors[issue.priority], borderLeft: `2px solid ${priorityColors[issue.priority]}` }}>
                      <IssueTypeIcon type={issue.type || 'task'} size={12} /> {issue.cfKey ?? issue.key} {issue.summary}
                    </Link>
                  ))}
                  {dayIssues.length > 3 && <span className="text-[10px] text-gray-400 px-1">+{dayIssues.length - 3} more</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Timeline (Gantt-style) */}
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-4">Timeline</h2>
        <div className="space-y-1">
          {issues.filter(i => i.dueDate).slice(0, 20).map(issue => {
            const created = new Date(issue.createdAt).getTime();
            const due = new Date(issue.dueDate!).getTime();
            const now = Date.now();
            const totalRange = 30 * 24 * 60 * 60 * 1000; // 30 days
            const monthStart = startOfMonth(currentMonth).getTime();
            const left = Math.max(0, Math.min(100, ((created - monthStart) / totalRange) * 100));
            const width = Math.max(2, Math.min(100 - left, ((due - created) / totalRange) * 100));
            const isOverdue = due < now && issue.status.category !== 'done';

            return (
              <div key={issue.id} className="flex items-center gap-3 py-1.5">
                <Link href={`/issues/${issue.cfKey ?? issue.key}`} className="text-xs text-blue-600 w-20 truncate hover:underline">{issue.cfKey ?? issue.key}</Link>
                <span className="text-xs text-gray-600 w-40 truncate">{issue.summary}</span>
                <div className="flex-1 h-5 bg-gray-100 rounded relative">
                  <div className={`absolute h-full rounded ${isOverdue ? 'bg-red-400' : 'bg-blue-400'}`}
                    style={{ left: `${left}%`, width: `${width}%`, minWidth: '8px' }} />
                </div>
                <span className="text-[10px] text-gray-400 w-20">{format(new Date(issue.dueDate!), 'MMM d')}</span>
              </div>
            );
          })}
          {issues.filter(i => i.dueDate).length === 0 && <p className="text-center text-gray-500 py-4">No issues with due dates</p>}
        </div>
      </div>
    </div>
  );
}
