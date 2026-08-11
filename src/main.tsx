import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {FeedbackProvider} from './components/ui/FeedbackProvider';
import {ServiceWorkerUpdater} from './components/ServiceWorkerUpdater';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FeedbackProvider>
      <ServiceWorkerUpdater />
      <App />
    </FeedbackProvider>
  </StrictMode>,
);
