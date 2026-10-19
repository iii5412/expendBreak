import { createRoot } from 'react-dom/client';
import { BudgetApp } from './BudgetApp';
import { LocalBudgetView } from './LocalBudgetView';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  new URLSearchParams(window.location.search).get('mode') === 'mock' ? <BudgetApp /> : <LocalBudgetView />,
);
