import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import '@fontsource-variable/inter'
import './index.css'
import { applySavedBrand } from './lib/brand'
import { installErrorReporting } from './lib/errors'

applySavedBrand()
installErrorReporting()
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
