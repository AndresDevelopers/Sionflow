'use client'

import { useEffect } from 'react'


// Fallback translations for global error (when i18n context might not be available)
const translations = {
  es: {
    title: 'Algo salió mal',
    description: 'Ha ocurrido un error inesperado. Nuestro equipo ha sido notificado.',
    tryAgain: 'Intentar de nuevo',
    goHome: 'Volver al inicio',
    errorDetails: 'Detalles del error (desarrollo)'
  },
  en: {
    title: 'Something went wrong',
    description: 'An unexpected error occurred. Our team has been notified.',
    tryAgain: 'Try again',
    goHome: 'Go to home',
    errorDetails: 'Error details (development)'
  }
}

// Simple language detection fallback
const getLanguage = (): 'es' | 'en' => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('language')
    if (stored === 'en' || stored === 'es') return stored
    return navigator.language.startsWith('es') ? 'es' : 'en'
  }
  return 'es' // Default to Spanish
}

interface GlobalErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  const lang = getLanguage()
  const t = translations[lang]

  useEffect(() => {
    console.error('GlobalError:', error.message, error.digest)
  }, [error])

  const handleGoHome = () => {
    window.location.href = '/'
  }

  return (
    <html lang={lang}>
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
          <div className="w-full max-w-md text-center">
            <div className="mb-8">
              <h1 className="text-6xl font-bold text-gray-900" aria-label="Error 500">
                500
              </h1>
              <h2 className="mt-4 text-2xl font-semibold text-gray-700">
                {t.title}
              </h2>
              <p className="mt-2 text-gray-600">
                {t.description}
              </p>
            </div>
            
            <div className="space-y-4">
              <button
                onClick={reset}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                aria-label={t.tryAgain}
              >
                {t.tryAgain}
              </button>
              
              <button
                onClick={handleGoHome}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                aria-label={t.goHome}
              >
                {t.goHome}
              </button>
            </div>
            
            {process.env.NODE_ENV === 'development' && (
              <details className="mt-8 text-left">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                  {t.errorDetails}
                </summary>
                <pre className="mt-2 overflow-auto rounded bg-gray-100 p-4 text-xs text-gray-800 max-h-64">
                  <code>
                    {error.message}
                    {error.stack && `\n\nStack trace:\n${error.stack}`}
                    {error.digest && `\n\nDigest: ${error.digest}`}
                  </code>
                </pre>
              </details>
            )}
          </div>
        </div>
      </body>
    </html>
  )
}
