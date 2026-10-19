import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/figtree'
import './index.css'
import { installErrorReporting } from './lib/errors'

installErrorReporting()
// Old links used /#/page addresses (emails, WhatsApp messages, embeds). Move them to the clean address before the router starts.
if (window.location.hash.startsWith('#/')) window.history.replaceState(null, '', window.location.hash.slice(1) || '/')
import App from './App.tsx'

// Service worker for phone notifications (and "Add to Home Screen"). Harmless where unsupported.
if ('serviceWorker' in navigator && window.isSecureContext) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
