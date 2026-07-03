import { collection, type CollectionReference } from 'firebase/firestore';
import { firestore, storage } from './firebase'; // Import the initialized storage instance

export { storage }; // Export storage directly

const coll = (path: string) => {
  return firestore ? collection(firestore, path) : (undefined as unknown as CollectionReference);
};

export const ministeringCollection = coll('c_ministracion');
export const ministeringDistrictsCollection = coll('c_ministracion_distritos');
export const ministeringHistoryCollection = coll('c_ministracion_historial');
export const convertsCollection = coll('c_conversos');
export const futureMembersCollection = coll('c_futuros_miembros');
export const activitiesCollection = coll('c_actividades');
export const annotationsCollection = coll('c_anotaciones');
export const birthdaysCollection = coll('c_cumpleanos');
export const baptismsCollection = coll('c_bautismos');
export const familySearchTrainingsCollection = coll('c_fs_capacitaciones');
export const familySearchTasksCollection = coll('c_fs_pendientes');
export const familySearchAnnotationsCollection = coll('c_fs_anotaciones');
export const missionaryAssignmentsCollection = coll('c_obra_misional_asignaciones');
export const investigatorsCollection = coll('c_obra_misional_investigadores');
export const newConvertFriendsCollection = coll('c_obra_misional_amigos_conversos');
export const missionaryImagesCollection = coll('c_obra_misional_imagenes');
export const servicesCollection = coll('c_servicios');
export const annualReportsCollection = coll('c_reporte_anual');
export const pushSubscriptionsCollection = coll('c_push_subscriptions');
export const usersCollection = coll('c_users');
export const notificationsCollection = coll('c_notifications');
export const healthConcernsCollection = coll('c_observaciones_salud');
export const membersCollection = coll('c_miembros');
export const adminAuditCollection = coll('c_admin_audit');
export const barriosCollection = coll('c_barrios');
export const organizacionesCollection = coll('c_organizaciones');
// Add other collections here
