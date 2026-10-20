import '@fontsource-variable/inter';
import '@fontsource-variable/literata';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 2000, retry: false, refetchOnWindowFocus: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={qc}>
    <App />
  </QueryClientProvider>,
);
