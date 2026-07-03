'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { firestore } from '@/lib/firebase';
import { membersCollection } from '@/lib/collections';
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

/**
 * Componente de prueba específico para la conexión a Firestore
 * Identifica problemas de inicialización y permisos
 */
export function ConnectionTest() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<string[]>([]);

  const addResult = (message: string) => {
    setResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  const runConnectionTest = async () => {
    setTesting(true);
    setResults([]);

    try {
      addResult('🔍 Iniciando pruebas de conexión...');

      // Test 1: Check user authentication
      if (!user) {
        addResult('❌ Usuario no autenticado');
        toast({
          title: 'Error de Autenticación',
          description: 'Debes estar autenticado para crear miembros.',
          variant: 'destructive'
        });
        setTesting(false);
        return;
      }
      addResult(`✅ Usuario autenticado: ${user.email}`);

      // Test 2: Check Firestore initialization
      if (!firestore) {
        addResult('❌ Firestore no inicializado');
        toast({
          title: 'Error de Firebase',
          description: 'Firestore no está inicializado correctamente.',
          variant: 'destructive'
        });
        setTesting(false);
        return;
      }
      addResult('✅ Firestore inicializado');

      // Test 3: Check members collection
      if (!membersCollection) {
        addResult('❌ Colección de miembros no disponible');
        toast({
          title: 'Error de Colección',
          description: 'La colección de miembros no está disponible.',
          variant: 'destructive'
        });
        setTesting(false);
        return;
      }
      addResult('✅ Colección de miembros disponible');

      // Test 4: Try to read from collection (test permissions)
      try {
        addResult('🔍 Probando permisos de lectura...');
        const snapshot = await getDocs(membersCollection);
        addResult(`✅ Lectura exitosa: ${snapshot.size} documentos encontrados`);
      } catch (readError) {
        addResult(`❌ Error de lectura: ${readError instanceof Error ? readError.message : 'Error desconocido'}`);
        toast({
          title: 'Error de Permisos',
          description: 'No tienes permisos para leer la colección de miembros.',
          variant: 'destructive'
        });
        setTesting(false);
        return;
      }

      // Test 5: Try to create a test document
      try {
        addResult('🔍 Probando permisos de escritura...');
        const testData = {
          firstName: 'Test',
          lastName: 'Connection',
          status: 'active' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: user.uid,
          lastActiveDate: new Date(),
        };

        const docRef = await addDoc(membersCollection, testData);
        addResult(`✅ Escritura exitosa: documento creado con ID ${docRef.id}`);

        // Clean up: delete the test document
        try {
          await deleteDoc(doc(membersCollection, docRef.id));
          addResult('🧹 Documento de prueba eliminado');
        } catch (deleteError) {
          addResult(`⚠️ No se pudo eliminar el documento de prueba: ${deleteError instanceof Error ? deleteError.message : 'Error desconocido'}`);
        }

        toast({
          title: '✅ Conexión Exitosa',
          description: 'Todos los sistemas funcionan correctamente.',
        });

      } catch (writeError) {
        addResult(`❌ Error de escritura: ${writeError instanceof Error ? writeError.message : 'Error desconocido'}`);
        
        // Analyze specific error types
        if (writeError instanceof Error) {
          if (writeError.message.includes('permission-denied')) {
            toast({
              title: 'Error de Permisos',
              description: 'No tienes permisos para crear miembros. Verifica las reglas de Firestore.',
              variant: 'destructive'
            });
          } else if (writeError.message.includes('unavailable')) {
            toast({
              title: 'Servicio No Disponible',
              description: 'Firebase no está disponible. Verifica tu conexión.',
              variant: 'destructive'
            });
          } else {
            toast({
              title: 'Error de Escritura',
              description: writeError.message,
              variant: 'destructive'
            });
          }
        }
      }

    } catch (generalError) {
      addResult(`❌ Error general: ${generalError instanceof Error ? generalError.message : 'Error desconocido'}`);
      toast({
        title: 'Error General',
        description: 'Ocurrió un error inesperado durante las pruebas.',
        variant: 'destructive'
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>🔧 Prueba de Conexión Firebase</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button 
          onClick={runConnectionTest} 
          disabled={testing}
          className="w-full"
        >
          {testing ? '🔄 Ejecutando pruebas...' : '🚀 Probar Conexión'}
        </Button>

        {results.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium">Resultados:</h4>
            <div className="bg-gray-50 p-3 rounded-md max-h-60 overflow-y-auto">
              <pre className="text-xs whitespace-pre-wrap">
                {results.join('\n')}
              </pre>
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          <p>Esta prueba verifica paso a paso la conexión a Firebase.</p>
          <p>Si alguna prueba falla, el problema estará identificado específicamente.</p>
        </div>
      </CardContent>
    </Card>
  );
}
