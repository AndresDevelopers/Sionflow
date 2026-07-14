'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { migrateExistingMinisteringAssignments } from '@/lib/migrate-ministering';
import { useI18n } from '@/contexts/i18n-context';
import { useAuth } from '@/contexts/auth-context';

export default function MigrateMinisteringPage() {
  const { t } = useI18n();
  const { barrioOrg } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleMigration = async () => {
    setIsRunning(true);
    setResult(null);
    setError(null);

    try {
      if (!barrioOrg) {
        throw new Error(t('ministering.migrate.unknownError'));
      }
      const migrationResult = await migrateExistingMinisteringAssignments({ barrioOrg });
      setResult(migrationResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ministering.migrate.unknownError'));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{t('ministering.migrate.title')}</CardTitle>
          <CardDescription>
            {t('ministering.migrate.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t('ministering.migrate.importantTitle')}</AlertTitle>
            <AlertDescription>
              {t('ministering.migrate.importantDescription')}
            </AlertDescription>
          </Alert>

          <Button 
            onClick={handleMigration} 
            disabled={isRunning || !barrioOrg}
            className="w-full"
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('ministering.migrate.running')}
              </>
            ) : (
              t('ministering.migrate.run')
            )}
          </Button>

          {result && (
            <Alert className="border-green-500 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800">{t('ministering.migrate.completedTitle')}</AlertTitle>
              <AlertDescription className="text-green-700">
                <div className="mt-2 space-y-1">
                  <p>{t('ministering.migrate.totalMembers', { count: result.totalMembers })}</p>
                  <p>{t('ministering.migrate.processedMembers', { count: result.processedMembers })}</p>
                  <p>{t('ministering.migrate.syncedMembers', { count: result.syncedMembers })}</p>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t('ministering.error')}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              {t('ministering.migrate.afterHint')}{' '}
              <Link href="/ministering" className="text-blue-600 hover:underline">
                {t('ministering.title')}
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
