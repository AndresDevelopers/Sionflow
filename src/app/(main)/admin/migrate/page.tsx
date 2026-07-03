"use client";

import { useEffect, useState } from "react";
import {
  getDocs,
  query,
  limit as fbLimit,
  doc,
  writeBatch,
  collection,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import {
  usersCollection,
  membersCollection,
  convertsCollection,
  activitiesCollection,
  servicesCollection,
  futureMembersCollection,
  birthdaysCollection,
  ministeringCollection,
  ministeringDistrictsCollection,
  ministeringHistoryCollection,
  baptismsCollection,
  annotationsCollection,
  healthConcernsCollection,
  annualReportsCollection,
  newConvertFriendsCollection,
  investigatorsCollection,
  missionaryAssignmentsCollection,
  missionaryImagesCollection,
  familySearchTrainingsCollection,
  familySearchTasksCollection,
  familySearchAnnotationsCollection,
  adminAuditCollection,
} from "@/lib/collections";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import logger from "@/lib/logger";
import {
  Database,
  Loader2,
  UserCog,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

interface UserInfo {
  uid: string;
  name: string;
  email: string;
  barrio: string;
  organizacion: string;
  barrioOrg: string;
  role: string;
}

const DATA_COLLECTIONS: { ref: ReturnType<typeof collection>; label: string }[] = [
  { ref: membersCollection, label: "Miembros" },
  { ref: convertsCollection, label: "Conversos" },
  { ref: activitiesCollection, label: "Actividades" },
  { ref: servicesCollection, label: "Servicios" },
  { ref: futureMembersCollection, label: "Futuros miembros" },
  { ref: birthdaysCollection, label: "Cumpleaños" },
  { ref: ministeringCollection, label: "Ministración" },
  { ref: ministeringDistrictsCollection, label: "Distritos ministración" },
  { ref: ministeringHistoryCollection, label: "Historial ministración" },
  { ref: baptismsCollection, label: "Bautismos" },
  { ref: annotationsCollection, label: "Anotaciones" },
  { ref: healthConcernsCollection, label: "Salud" },
  { ref: annualReportsCollection, label: "Reporte anual" },
  { ref: newConvertFriendsCollection, label: "Amigos conversos" },
  { ref: investigatorsCollection, label: "Investigadores" },
  { ref: missionaryAssignmentsCollection, label: "Asignaciones misionales" },
  { ref: missionaryImagesCollection, label: "Imágenes misionales" },
  { ref: familySearchTrainingsCollection, label: "Capacitaciones FS" },
  { ref: familySearchTasksCollection, label: "Tareas FS" },
  { ref: familySearchAnnotationsCollection, label: "Anotaciones FS" },
  { ref: adminAuditCollection, label: "Auditoría" },
];

export default function MigratePage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [migrationStatus, setMigrationStatus] = useState<string[]>([]);
  const [isMigrating, setIsMigrating] = useState(false);
  const [selectedUserBarrioOrg, setSelectedUserBarrioOrg] = useState<string>("");
  const [migrationCounts, setMigrationCounts] = useState<Record<string, { total: number; missing: number }>>({});

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const snap = await getDocs(usersCollection);
      const list: UserInfo[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          uid: d.id,
          name: data.name || "Sin nombre",
          email: data.email || "—",
          barrio: data.barrio || "Sin barrio",
          organizacion: data.organizacion || "Sin organización",
          barrioOrg: data.barrioOrg || "",
          role: data.role || "user",
        });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setUsers(list);
    } catch (err) {
      logger.error({ error: err, message: "Error loading users for migration" });
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const analyzeCollection = async (
    collectionRef: ReturnType<typeof collection>,
    _barrioOrg: string
  ): Promise<{ total: number; missing: number }> => {
    try {
      const snap = await getDocs(query(collectionRef, fbLimit(500)));
      let total = 0;
      let missing = 0;
      snap.forEach((d) => {
        total++;
        const data = d.data();
        if (!data.barrioOrg || data.barrioOrg === "") {
          missing++;
        }
      });
      return { total, missing };
    } catch {
      return { total: 0, missing: 0 };
    }
  };

  const handleAnalyze = async () => {
    if (!selectedUserBarrioOrg) {
      toast({ title: "Selecciona un usuario", description: "Elige un usuario de referencia.", variant: "destructive" });
      return;
    }
    setMigrationStatus([]);
    setIsMigrating(true);
    const counts: Record<string, { total: number; missing: number }> = {};

    try {
      for (const col of DATA_COLLECTIONS) {
        const result = await analyzeCollection(col.ref, selectedUserBarrioOrg);
        counts[col.label] = result;
        setMigrationCounts({ ...counts });
      }
      setMigrationCounts(counts);
      toast({ title: "Análisis completo", description: "Revisa los resultados abajo." });
    } catch (err) {
      logger.error({ error: err, message: "Error analyzing collections" });
    } finally {
      setIsMigrating(false);
    }
  };

  const handleMigrateAll = async () => {
    if (!selectedUserBarrioOrg) return;

    const totalMissing = Object.values(migrationCounts).reduce((sum, c) => sum + c.missing, 0);
    if (totalMissing === 0) {
      toast({ title: "Nada que migrar", description: "Todas las colecciones ya tienen barrioOrg." });
      return;
    }

    setIsMigrating(true);
    const log: string[] = [];

    try {
      for (const col of DATA_COLLECTIONS) {
        const info = migrationCounts[col.label];
        if (!info || info.missing === 0) continue;

        const snap = await getDocs(query(col.ref, fbLimit(500)));
        const batch = writeBatch(firestore);
        let batchCount = 0;
        let updatedCount = 0;

        snap.forEach((d) => {
          const data = d.data();
          if (!data.barrioOrg || data.barrioOrg === "") {
            batch.update(doc(col.ref, d.id), { barrioOrg: selectedUserBarrioOrg });
            batchCount++;
            updatedCount++;
            if (batchCount >= 450) {
              // Would need to commit and create new batch, but for simplicity we warn
            }
          }
        });

        if (batchCount > 0) {
          await batch.commit();
          log.push(`✅ ${col.label}: ${updatedCount} docs actualizados`);
        }
        setMigrationStatus([...log]);
      }

      log.push("---");
      log.push("🎉 Migración completada.");
      setMigrationStatus(log);
      toast({ title: "Migración completa", description: "Todos los documentos sin barrioOrg fueron actualizados." });

      // Reload analysis
      await handleAnalyze();
    } catch (err) {
      logger.error({ error: err, message: "Error migrating data" });
      log.push("❌ Error durante la migración");
      setMigrationStatus(log);
      toast({ title: "Error", description: "Ocurrió un error durante la migración.", variant: "destructive" });
    } finally {
      setIsMigrating(false);
    }
  };

  const totalMissingAll = Object.values(migrationCounts).reduce((sum, c) => sum + c.missing, 0);

  return (
    <section className="page-section">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Database className="h-6 w-6 text-primary" />
          <h1 className="text-balance text-fluid-title font-semibold">
            Migración de datos
          </h1>
        </div>
        <p className="text-balance text-fluid-subtitle text-muted-foreground">
          Asigna barrio/organización a documentos existentes para activar el alcance por barrio.
        </p>
      </header>

      {/* Users reference */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCog className="h-4 w-4" />
            Usuarios registrados
          </CardTitle>
          <CardDescription>
            Cada usuario tiene su barrio y organización. Úsalos como referencia para migrar datos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingUsers ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Usuario</th>
                    <th className="px-3 py-2 font-medium">Barrio</th>
                    <th className="px-3 py-2 font-medium">Organización</th>
                    <th className="px-3 py-2 font-medium">Rol</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.uid}
                      className={`cursor-pointer border-t transition-colors hover:bg-muted/50 ${
                        selectedUserBarrioOrg === u.barrioOrg ? "bg-primary/10" : ""
                      }`}
                      onClick={() => setSelectedUserBarrioOrg(u.barrioOrg)}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="px-3 py-2">{u.barrio}</td>
                      <td className="px-3 py-2">{u.organizacion}</td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className="text-xs">{u.role}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedUserBarrioOrg && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="text-sm">
                  BarrioOrg seleccionado:{" "}
                  <Badge variant="secondary" className="ml-1 font-mono text-xs">
                    {selectedUserBarrioOrg}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Este valor se asignará a los documentos sin barrioOrg.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleAnalyze} disabled={isMigrating}>
                  {isMigrating ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-4 w-4" />
                  )}
                  Analizar
                </Button>
                <Button onClick={handleMigrateAll} disabled={isMigrating || totalMissingAll === 0}>
                  {isMigrating ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                  )}
                  Migrar ({totalMissingAll} pendientes)
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analysis results */}
      {Object.keys(migrationCounts).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultados del análisis</CardTitle>
            <CardDescription>
              Documentos que necesitan barrioOrg en cada colección.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(migrationCounts).map(([label, info]) => (
                <div
                  key={label}
                  className={`flex items-center justify-between rounded-md border p-3 ${
                    info.missing > 0 ? "border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20" : ""
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{info.total} docs</p>
                  </div>
                  {info.missing > 0 ? (
                    <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
                      {info.missing} sin barrioOrg
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-emerald-600 dark:text-emerald-400">
                      OK
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Migration log */}
      {migrationStatus.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registro de migración</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-64 overflow-y-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap">
              {migrationStatus.join("\n")}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
            <AlertTriangle className="h-5 w-5" />
            Instrucciones
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-amber-800 dark:text-amber-200">
          <p>1. Revisa la tabla de usuarios para ver qué barrio/organización tiene cada uno.</p>
          <p>2. Haz clic en un usuario para seleccionar su <code className="rounded bg-amber-200/50 px-1 dark:bg-amber-800/50">barrioOrg</code>.</p>
          <p>3. Haz clic en <strong>Analizar</strong> para ver cuántos documentos en cada colección no tienen barrioOrg.</p>
          <p>4. Haz clic en <strong>Migrar</strong> para asignar el barrioOrg seleccionado a esos documentos.</p>
          <p className="font-medium">
            Repite este proceso por cada combinación de barrio/organización que exista en tus datos.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
