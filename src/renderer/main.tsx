import {
  rendererErrorBuffer,
  patchRendererConsoleError,
  installGlobalErrorHandlers,
} from './bootstrap/rendererErrorCapture'

patchRendererConsoleError(rendererErrorBuffer)
installGlobalErrorHandlers(rendererErrorBuffer)

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { BugReportModal } from './components/bugReport/BugReportModal'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <>
      <App />
      <BugReportModal />
    </>
  </React.StrictMode>
)
