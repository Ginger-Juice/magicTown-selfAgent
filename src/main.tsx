import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './index.css';
import { TRPCProvider } from "@/providers/trpc"
import { LanguageProvider } from '@/lib/i18n';
import { AuthProvider } from '@/providers/auth';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <TRPCProvider>
      <LanguageProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </LanguageProvider>
    </TRPCProvider>
  </BrowserRouter>,
);
