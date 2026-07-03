'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { migrateExistingMinisteringAssignments } from '@/lib/migrate-ministering';

export default function MigrateMinisteringPage() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleMigration = async () => {
    setIsRunning(true);
    setResult(null);
    setError(null);

    try {
      const migrationResult = await migrateExistingMinisteringAssignments();
      setResult(migrationResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Migración de Maestros Ministrantes</CardTitle>
          <CardDescription>
            Esta herramienta sincronizará todos los maestros ministrantes asignados a los miembros
            y creará automáticamente los compañerismos correspondientes en la página de ministración.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Importante</AlertTitle>
            <AlertDescription>
              Esta operación revisará todos los miembros que tienen maestros ministrantes asignados
              y creará o actualizará los compañerismos correspondientes. Es seguro ejecutarla múltiples veces.
            </AlertDescription>
          </Alert>

          <Button 
            onClick={handleMigration} 
            disabled={isRunning}
            className="w-full"
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Ejecutando migración...
              </>
            ) : (
              'Ejecutar Migración'
            )}
          </Button>

          {result && (
            <Alert className="border-green-500 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800">Migración Completada</AlertTitle>
              <AlertDescription className="text-green-700">
                <div className="mt-2 space-y-1">
                  <p>Total de miembros: {result.totalMembers}</p>
                  <p>Miembros con maestros: {result.processedMembers}</p>
                  <p>Sincronizados exitosamente: {result.syncedMembers}</p>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              Después de ejecutar la migración, ve a la página de{' '}
              <Link href="/ministering" className="text-blue-600 hover:underline">
                Ministración
              </Link>{' '}
              para ver los compañerismos creados.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
