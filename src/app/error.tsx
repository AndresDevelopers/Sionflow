'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useEffect } from 'react';
import logger from '@/lib/logger';


function getErrorMessage(error: any): string {
  if (error) {
    if (typeof error.message === 'string' && error.message.trim().length > 0) {
      return error.message;
    }
    if (typeof error.toString === 'function') {
      const errorString = error.toString();
      if (errorString !== '[object Object]') {
        return errorString;
      }
    }
    try {
      return JSON.stringify(error, null, 2);
    } catch (e) {
      logger.warn({ error: e, message: 'Failed to serialize error for display' });
    }
  }
  return 'Ocurrió un error desconocido.';
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error({ error, message: 'Caught by Error Boundary' });
  }, [error]);

  const errorMessage = getErrorMessage(error);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-destructive">
            ¡Ups! Algo salió mal
          </CardTitle>
          <CardDescription>
            Se ha producido un error inesperado en la aplicación. Nuestro equipo ha sido notificado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            <p className="font-semibold">Detalles del Error:</p>
            <pre className="whitespace-pre-wrap font-mono text-xs">
              {errorMessage}
            </pre>
          </div>
          <Button onClick={() => reset()} className="w-full">
            Intentar de nuevo
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
