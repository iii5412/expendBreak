import React from 'react';

interface ScreenHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}

/** A shared decision-first heading for every primary workspace screen. */
export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  eyebrow,
  title,
  description,
  icon,
  actions,
  meta,
}) => (
  <section className="eb-enter border-b border-slate-800/90 pb-4" aria-labelledby={`screen-${eyebrow.replace(/\s+/g, '-').toLowerCase()}`}>
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-rose-400">
          {icon && <span className="text-rose-400" aria-hidden="true">{icon}</span>}
          <span>{eyebrow}</span>
        </div>
        <h2
          id={`screen-${eyebrow.replace(/\s+/g, '-').toLowerCase()}`}
          className="eb-display mt-2 text-2xl font-extrabold tracking-[-0.04em] text-white sm:text-3xl"
        >
          {title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">{description}</p>
        {meta && <div className="mt-2 text-xs text-slate-400">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  </section>
);
