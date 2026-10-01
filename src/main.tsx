import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {FeedbackProvider} from './components/ui/FeedbackProvider';
import {ErrorBoundary} from './components/ui/ErrorBoundary';
import {ServiceWorkerUpdater} from './components/ServiceWorkerUpdater';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary scope="app" level="app">
      <FeedbackProvider>
        <ServiceWorkerUpdater />
        <App />
      </FeedbackProvider>
    </ErrorBoundary>
  </StrictMode>,
);
