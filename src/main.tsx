import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {FeedbackProvider} from './components/ui/FeedbackProvider';
import {ErrorBoundary} from './components/ui/ErrorBoundary';
import {ServiceWorkerUpdater} from './components/ServiceWorkerUpdater';
import {LiveUpdateGuard} from './components/LiveUpdateGuard';
import {applyPendingLiveBundle} from './utils/liveUpdate';
import './index.css';

async function boot() {
  // A downloaded screen update is switched in before anything renders.
  if (await applyPendingLiveBundle()) return;

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary scope="app" level="app">
        <FeedbackProvider>
          <ServiceWorkerUpdater />
          <LiveUpdateGuard />
          <App />
        </FeedbackProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

void boot();
