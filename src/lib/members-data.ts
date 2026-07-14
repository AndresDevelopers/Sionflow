// This is a fixed version of the members-data.ts file with the necessary changes

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  where,
  orderBy,
  Timestamp,
  QueryConstraint,
} from 'firebase/firestore';
import { getDocs, getDoc } from '@/lib/firestore-query';
import { firestore, storage as firebaseStorage } from '@/lib/firebase';
import { ref, deleteObject } from 'firebase/storage';
import { uploadBytesOfflineAware } from '@/lib/storage-offline-queue';
import type { Member, MemberStatus, Ordinance, TempleOrdinance } from './types';
import { compressProfileImage, compressGalleryImage } from './image-compression';
import logger from './logger';

// Always use the shared client instance (persistentLocalCache / offline)
function getFirestoreInstance() {
  if (!firestore) {
    throw new Error('Firestore is not available (client-only)');
  }
  return firestore;
}

function getStorageInstance() {
  if (!firebaseStorage) {
    throw new Error('Storage is not available (client-only)');
  }
  return firebaseStorage;
}

export const normalizeMemberStatus = (status?: unknown): MemberStatus => {
  if (typeof status !== 'string') return 'active';

  const normalized = status.toLowerCase().trim();
  if (['deceased', 'fallecido', 'fallecida'].includes(normalized)) return 'deceased';
  if (['inactive', 'inactivo'].includes(normalized)) return 'inactive';
  if (['less_active', 'less active', 'menos activo', 'menos_activo'].includes(normalized)) {
    return 'less_active';
  }
  if (['active', 'activo'].includes(normalized)) return 'active';

  return 'active';
};

// Create a new member
export async function createMember(memberData: Omit<Member, 'id'>, barrioOrg: string): Promise<string> {
  try {
    // Validate required fields
    if (!memberData.firstName || !memberData.lastName) {
      throw new Error('First name and last name are required');
    }

    // Get firestore instance
    const db = getFirestoreInstance();
    const membersCollection = collection(db, 'c_miembros');

    // Clean the data before saving - remove undefined values
    const cleanData: any = {
      firstName: memberData.firstName.trim(),
      lastName: memberData.lastName.trim(),
      status: memberData.status,
      createdAt: memberData.createdAt,
      updatedAt: memberData.updatedAt,
      createdBy: memberData.createdBy,
      barrioOrg,
    };

    // Only add optional fields if they have valid values
    if (memberData.phoneNumber?.trim()) {
      cleanData.phoneNumber = memberData.phoneNumber.trim();
    }

    if (memberData.memberId?.trim()) {
      cleanData.memberId = memberData.memberId.trim();
    }

    if (memberData.email?.trim()) {
      cleanData.email = memberData.email.trim();
    }

    if (memberData.address?.trim()) {
      cleanData.address = memberData.address.trim();
    }

    if (memberData.photoURL?.trim()) {
      cleanData.photoURL = memberData.photoURL.trim();
    }

    if (memberData.birthDate) {
      cleanData.birthDate = memberData.birthDate;
    }

    // Add baptism date if it exists
    if (memberData.baptismDate) {
      cleanData.baptismDate = memberData.baptismDate;
    }

    if (memberData.deathDate) {
      cleanData.deathDate = memberData.deathDate;
    }

    // Add baptism photos if they exist
    if (memberData.baptismPhotos && memberData.baptismPhotos.length > 0) {
      cleanData.baptismPhotos = memberData.baptismPhotos;
    }

    // Add ordinances if they exist
    if (memberData.ordinances && memberData.ordinances.length > 0) {
      cleanData.ordinances = memberData.ordinances;
    }

    // Add ministering teachers if they exist
    if (memberData.ministeringTeachers && memberData.ministeringTeachers.length > 0) {
      cleanData.ministeringTeachers = memberData.ministeringTeachers;
    }

    if (memberData.lastActiveDate) {
      cleanData.lastActiveDate = memberData.lastActiveDate;
    }

    if (memberData.inactiveSince) {
      cleanData.inactiveSince = memberData.inactiveSince;
    }

    const docRef = await addDoc(membersCollection, cleanData);
    return docRef.id;
  } catch (error) {
    console.error('Error creating member:', error);

    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.message.includes('permission-denied')) {
        throw new Error('No tienes permisos para crear miembros. Verifica tu autenticación.');
      } else if (error.message.includes('network')) {
        throw new Error('Error de conexión. Verifica tu conexión a internet.');
      } else if (error.message.includes('not-found')) {
        throw new Error('Base de datos no encontrada. Verifica la configuración de Firebase.');
      } else if (error.message.includes('invalid-argument') || error.message.includes('undefined')) {
        throw new Error('Datos inválidos. Verifica que todos los campos estén correctamente completados.');
      }
      throw new Error(`Error al crear miembro: ${error.message}`);
    }

    throw new Error('Error desconocido al crear miembro');
  }
}

// Update an existing member
export async function updateMember(
  memberId: string,
  memberData: Partial<Omit<Member, 'id' | 'createdAt' | 'createdBy'>>
): Promise<void> {
  try {
    if (!memberId) {
      throw new Error('ID de miembro no proporcionado');
    }

    // Validar datos requeridos
    if (memberData.firstName !== undefined && !memberData.firstName?.trim()) {
      throw new Error('El nombre es requerido');
    }
    if (memberData.lastName !== undefined && !memberData.lastName?.trim()) {
      throw new Error('El apellido es requerido');
    }
    if (memberData.status && !['active', 'less_active', 'inactive', 'deceased'].includes(memberData.status)) {
      throw new Error(`Estado de miembro no válido: ${memberData.status}`);
    }

    // Get firestore instance - use client SDK for now, will be updated to admin SDK
    const db = getFirestoreInstance();
    const membersCollection = collection(db, 'c_miembros');
    const memberRef = doc(membersCollection, memberId);
    const currentMemberDoc = await getDoc(memberRef);

    if (!currentMemberDoc.exists()) {
      throw new Error('Miembro no encontrado');
    }

    const currentData = currentMemberDoc.data() as Member;
    // Never allow client to re-scope a member to another barrio
    if ('barrioOrg' in memberData) {
      delete (memberData as { barrioOrg?: string }).barrioOrg;
    }
    // Preparar datos limpios
    const cleanData: any = {
      updatedAt: Timestamp.now()
    };

    // Campos requeridos
    if (memberData.firstName !== undefined) {
      cleanData.firstName = memberData.firstName.trim();
    }
    if (memberData.lastName !== undefined) {
      cleanData.lastName = memberData.lastName.trim();
    }
    if (memberData.status !== undefined) {
      cleanData.status = memberData.status;
    }

    // Manejar campos opcionales
    const optionalFields: Record<string, any> = {
      phoneNumber: memberData.phoneNumber,
      email: memberData.email,
      memberId: memberData.memberId,
      address: memberData.address,
      photoURL: memberData.photoURL,
      birthDate: memberData.birthDate,
      baptismDate: memberData.baptismDate,
      deathDate: memberData.deathDate,
      baptismPhotos: memberData.baptismPhotos,
      ordinances: memberData.ordinances,
      templeOrdinances: memberData.templeOrdinances,
      templeWorkCompletedAt: memberData.templeWorkCompletedAt,
      ministeringTeachers: memberData.ministeringTeachers,
      isUrgent: memberData.isUrgent,
      urgentReason: memberData.urgentReason,
      urgentNotifiedAt: memberData.urgentNotifiedAt,
      isInCouncil: memberData.isInCouncil,
      inactiveObservation: memberData.inactiveObservation,
      lessActiveSince: memberData.lessActiveSince,
      lessActiveObservation: memberData.lessActiveObservation,
    };

    // Manejar inactiveSince según el estado
    if (memberData.inactiveSince !== undefined) {
      optionalFields.inactiveSince = memberData.inactiveSince;
    } else if (memberData.status === 'active') {
      optionalFields.inactiveSince = null;
    } else if (memberData.status === 'inactive' && !currentData.inactiveSince) {
      optionalFields.inactiveSince = Timestamp.now();
    }

    // Manejar lessActiveSince según el estado enviado
    if (memberData.lessActiveSince !== undefined) {
      // Ya se incluyó arriba en optionalFields, no hacer nada
    } else if (memberData.status === 'less_active' && !currentData.lessActiveSince) {
      optionalFields.lessActiveSince = Timestamp.now();
    }

    // Manejar lastActiveDate según el estado
    if (memberData.status === 'active') {
      optionalFields.lastActiveDate = Timestamp.now();
    }

    // Procesar cada campo opcional
    Object.entries(optionalFields).forEach(([field, value]) => {
      if (value !== undefined) {
        if (value === null || value === '') {
          cleanData[field] = deleteField();
        } else if (typeof value === 'string') {
          cleanData[field] = value.trim();
        } else if (value && typeof value === 'object' && 'toDate' in value) {
          // Check if it's a Firestore Timestamp
          cleanData[field] = value;
        } else if (value instanceof Date) {
          cleanData[field] = Timestamp.fromDate(value);
        } else {
          cleanData[field] = value;
        }
      }
    });

    // Validar que haya datos para actualizar
    if (Object.keys(cleanData).length <= 1) { // Solo updatedAt
      return;
    }

    // Realizar la actualización
    await updateDoc(memberRef, cleanData);
  } catch (error) {
    console.error('Error updating member:', error);

    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.message.includes('permission-denied')) {
        throw new Error('No tienes permisos para actualizar miembros. Verifica tu autenticación.');
      } else if (error.message.includes('network')) {
        throw new Error('Error de conexión. Verifica tu conexión a internet.');
      } else if (error.message.includes('not-found')) {
        throw new Error('Miembro no encontrado.');
      } else if (error.message.includes('invalid-argument') || error.message.includes('undefined')) {
        throw new Error('Datos inválidos. Verifica que todos los campos estén correctamente completados.');
      }
      throw new Error(`Error al actualizar miembro: ${error.message}`);
    }

    throw new Error('Error desconocido al actualizar miembro');
  }
}

// Get less active members for council page
export async function getLessActiveMembers(barrioOrg: string): Promise<Member[]> {
  try {
    // Get firestore instance
    const db = getFirestoreInstance();
    const membersCollection = collection(db, 'c_miembros');

    const q = query(
      membersCollection,
      where('barrioOrg', '==', barrioOrg),
      where('status', '==', 'less_active'),
      orderBy('lastName', 'asc')
    );

    const querySnapshot = await getDocs(q);
    const members: Member[] = [];

    querySnapshot.forEach((doc) => {
      const memberData = doc.data();
      // Ensure status has a default value if missing
      const processedMemberData = {
        ...memberData,
        status: normalizeMemberStatus(memberData.status)
      };

      members.push({
        id: doc.id,
        ...processedMemberData
      } as Member);
    });

    return members;
  } catch (error) {
    console.error('Error getting less active members:', error);

    if (error instanceof Error) {
      if (error.message.includes('permission-denied')) {
        throw new Error('No tienes permisos para acceder a los miembros.');
      } else if (error.message.includes('network')) {
        throw new Error('Error de conexión. Verifica tu conexión a internet.');
      }
      throw new Error(`Error al obtener miembros menos activos: ${error.message}`);
    }

    throw new Error('Error desconocido al obtener miembros menos activos');
  }
}

// Get inactive members for council page
export async function getInactiveMembers(barrioOrg: string): Promise<Member[]> {
  try {
    const db = getFirestoreInstance();
    const membersCollection = collection(db, 'c_miembros');

    const q = query(
      membersCollection,
      where('barrioOrg', '==', barrioOrg),
      where('status', '==', 'inactive'),
      orderBy('lastName', 'asc')
    );

    const querySnapshot = await getDocs(q);
    const members: Member[] = [];

    querySnapshot.forEach((doc) => {
      const memberData = doc.data();
      const processedMemberData = {
        ...memberData,
        status: normalizeMemberStatus(memberData.status)
      };

      members.push({
        id: doc.id,
        ...processedMemberData
      } as Member);
    });

    return members;
  } catch (error) {
    console.error('Error getting inactive members:', error);

    if (error instanceof Error) {
      if (error.message.includes('permission-denied')) {
        throw new Error('No tienes permisos para acceder a los miembros.');
      } else if (error.message.includes('network')) {
        throw new Error('Error de conexión. Verifica tu conexión a internet.');
      }
      throw new Error(`Error al obtener miembros inactivos: ${error.message}`);
    }

    throw new Error('Error desconocido al obtener miembros inactivos');
  }
}

// Get urgent members for council page
export async function getUrgentMembers(barrioOrg: string): Promise<Member[]> {
  try {
    const db = getFirestoreInstance();
    const membersCollection = collection(db, 'c_miembros');

    const q = query(
      membersCollection,
      where('barrioOrg', '==', barrioOrg),
      where('isUrgent', '==', true)
    );

    const querySnapshot = await getDocs(q);
    const members: Member[] = [];

    querySnapshot.forEach((docSnap) => {
      const memberData = docSnap.data();
      members.push({
        id: docSnap.id,
        ...memberData,
        status: normalizeMemberStatus(memberData.status)
      } as Member);
    });

    return members
      .filter(member => member.status !== 'deceased')
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
  } catch (error) {
    console.error('Error getting urgent members:', error);
    return [];
  }
}

// Get deceased members for dashboard and council pages
// Returns members with status 'deceased' who either:
// 1. Have incomplete ordinances (need temple work)
// 2. Have all ordinances complete but within 7 days of completion
export async function getDeceasedMembers(barrioOrg: string): Promise<Member[]> {
  try {
    const db = getFirestoreInstance();
    const membersCollection = collection(db, 'c_miembros');

    const q = query(
      membersCollection,
      where('barrioOrg', '==', barrioOrg),
      where('status', '==', 'deceased')
    );

    const querySnapshot = await getDocs(q);
    const members: Member[] = [];

    querySnapshot.forEach((docSnap) => {
      const memberData = docSnap.data();
      members.push({
        id: docSnap.id,
        ...memberData,
        status: normalizeMemberStatus(memberData.status)
      } as Member);
    });

    // Filter based on temple ordinances and 7-day rule
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // All possible temple ordinances for deceased members
    const allTempleOrdinances: TempleOrdinance[] = [
      'baptism',
      'confirmation',
      'initiatory',
      'endowment',
      'sealed_to_father',
      'sealed_to_mother',
      'sealed_to_spouse'
    ];

    return members.filter(member => {
      const memberOrdinances = member.templeOrdinances || [];
      const allComplete = allTempleOrdinances.every(ord => memberOrdinances.includes(ord));

      if (allComplete) {
        // If all ordinances are complete, check if within 7 days of completion
        const completedAt = member.templeWorkCompletedAt?.toDate();
        if (completedAt) {
          // Only show if within 7 days of completion
          return completedAt > sevenDaysAgo;
        }
        // If no completion date, show anyway (for backwards compatibility)
        return true;
      }
      // Show members who need temple work
      return true;
    }).sort((a, b) => a.lastName.localeCompare(b.lastName));
  } catch (error) {
    console.error('Error getting deceased members:', error);
    return [];
  }
}

// Delete a member
export async function deleteMember(memberId: string): Promise<void> {
  try {
    // Get firestore instance
    const db = getFirestoreInstance();
    const membersCollection = collection(db, 'c_miembros');
    const memberRef = doc(membersCollection, memberId);

    // Get member data to delete photo if exists
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      const memberData = memberDoc.data() as Member;

      // Delete photo from storage if it exists
      if (memberData.photoURL) {
        try {
          const storage = getStorageInstance();
          const photoRef = ref(storage, memberData.photoURL);
          await deleteObject(photoRef);
        } catch (photoError) {
          logger.warn({ error: photoError, message: 'Could not delete member photo' });
          // Continue with member deletion even if photo deletion fails
        }
      }
    }

    // Delete the member document
    await deleteDoc(memberRef);
  } catch (error) {
    logger.error({ error, message: 'Error deleting member', memberId });

    if (error instanceof Error) {
      if (error.message.includes('permission-denied')) {
        throw new Error('No tienes permisos para eliminar miembros.');
      } else if (error.message.includes('not-found')) {
        throw new Error('Miembro no encontrado.');
      } else if (error.message.includes('network')) {
        throw new Error('Error de conexión. Verifica tu conexión a internet.');
      }
      throw new Error(`Error al eliminar miembro: ${error.message}`);
    }

    throw new Error('Error desconocido al eliminar miembro');
  }
}

// Get members by status
export async function getMembersByStatus(
  status?: MemberStatus,
  options?: { includeDeceased?: boolean; barrioOrg?: string }
): Promise<Member[]> {
  try {
    // Fail closed: never list members across all barrios
    if (!options?.barrioOrg) {
      console.warn('getMembersByStatus called without barrioOrg — returning empty');
      return [];
    }
    // Get firestore instance
    const db = getFirestoreInstance();
    const membersCollection = collection(db, 'c_miembros');

    const constraints: QueryConstraint[] = [
      where('barrioOrg', '==', options.barrioOrg),
    ];

    // Add status filter if provided
    if (status) {
      constraints.push(where('status', '==', status));
    }

    // Always order by last name
    constraints.push(orderBy('lastName', 'asc'));

    const q = query(membersCollection, ...constraints);
    const querySnapshot = await getDocs(q);
    const members: Member[] = [];

    querySnapshot.forEach((doc) => {
      const memberData = doc.data();
      // Ensure status has a default value if missing
      const processedMemberData = {
        ...memberData,
        status: normalizeMemberStatus(memberData.status)
      };

      members.push({
        id: doc.id,
        ...processedMemberData
      } as Member);
    });

    if (!options?.includeDeceased && status !== 'deceased') {
      return members.filter(member => member.status !== 'deceased');
    }

    return members;
  } catch (error) {
    console.error('Error getting members by status:', error);

    if (error instanceof Error) {
      if (error.message.includes('permission-denied')) {
        throw new Error('No tienes permisos para acceder a los miembros.');
      } else if (error.message.includes('network')) {
        throw new Error('Error de conexión. Verifica tu conexión a internet.');
      }
      throw new Error(`Error al obtener miembros: ${error.message}`);
    }

    throw new Error('Error desconocido al obtener miembros');
  }
}

// Get members for selector component
export async function getMembersForSelector(includeInactive = false, barrioOrg?: string): Promise<Member[]> {
  try {
    // Fail closed: never list members across all barrios
    if (!barrioOrg) {
      console.warn('getMembersForSelector called without barrioOrg — returning empty');
      return [];
    }
    // Get firestore instance
    const db = getFirestoreInstance();
    const membersCollection = collection(db, 'c_miembros');

    const constraints: QueryConstraint[] = [
      where('barrioOrg', '==', barrioOrg),
    ];

    // Filter by status if not including inactive members
    if (!includeInactive) {
      constraints.push(where('status', 'in', ['active', 'less_active']));
    }

    // Always order by last name
    constraints.push(orderBy('lastName', 'asc'));

    const q = query(membersCollection, ...constraints);
    const querySnapshot = await getDocs(q);
    const members: Member[] = [];

    querySnapshot.forEach((doc) => {
      const memberData = doc.data();
      // Ensure status has a default value if missing
      const processedMemberData = {
        ...memberData,
        status: normalizeMemberStatus(memberData.status)
      };

      members.push({
        id: doc.id,
        ...processedMemberData
      } as Member);
    });

    return members.filter(member => member.status !== 'deceased');
  } catch (error) {
    console.error('Error getting members for selector:', error);

    if (error instanceof Error) {
      if (error.message.includes('permission-denied')) {
        throw new Error('No tienes permisos para acceder a los miembros.');
      } else if (error.message.includes('network')) {
        throw new Error('Error de conexión. Verifica tu conexión a internet.');
      }
      throw new Error(`Error al obtener miembros: ${error.message}`);
    }

    throw new Error('Error desconocido al obtener miembros');
  }
}

// Allow large camera originals; client compression reduces size before upload
const MAX_FILE_SIZE = 15 * 1024 * 1024;

function assertValidImageFile(file: File): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`El archivo ${file.name} supera los 15MB.`);
  }
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error(`El archivo ${file.name} no es una imagen válida.`);
  }
}

// Upload member photo to storage (compressed client-side).
// Offline: queues in IndexedDB via Firebase-aware helper and returns a local preview URL.
export async function uploadMemberPhoto(file: File, userId: string): Promise<string> {
  try {
    assertValidImageFile(file);
    getStorageInstance(); // ensure storage ready when online
    const optimized = await compressProfileImage(file);

    const safeName = optimized.name.replace(/[^\w.\-]+/g, '_');
    const { userScopedStoragePath } = await import('@/lib/storage-paths');
    const fileName = userScopedStoragePath(userId, 'members', safeName);

    const result = await uploadBytesOfflineAware(fileName, optimized, {
      contentType: optimized.type,
    });
    return result.url;
  } catch (error) {
    console.error('Error uploading member photo:', error);

    if (error instanceof Error) {
      if (error.message.includes('permission-denied')) {
        throw new Error('No tienes permisos para subir archivos.');
      } else if (error.message.includes('network')) {
        throw new Error('Error de conexión. Verifica tu conexión a internet.');
      } else if (error.message.includes('unauthorized')) {
        throw new Error('No autorizado para realizar esta acción.');
      }
      throw new Error(`Error al subir la foto: ${error.message}`);
    }

    throw new Error('Error desconocido al subir la foto');
  }
}

// Upload multiple baptism photos to storage (compressed client-side)
export async function uploadBaptismPhotos(files: File[], userId: string): Promise<string[]> {
  try {
    const storage = getStorageInstance();

    const uploadPromises = files.map(async (file, index) => {
      assertValidImageFile(file);
      const optimized = await compressGalleryImage(file);
      const safeName = optimized.name.replace(/[^\w.\-]+/g, '_');
      const { userScopedStoragePath } = await import('@/lib/storage-paths');
      const fileName = userScopedStoragePath(userId, 'baptism_photos', `${index}_${safeName}`);

      const result = await uploadBytesOfflineAware(fileName, optimized, {
        contentType: optimized.type,
      });
      return result.url;
    });

    return await Promise.all(uploadPromises);
  } catch (error) {
    console.error('Error uploading baptism photos:', error);

    if (error instanceof Error) {
      if (error.message.includes('permission-denied')) {
        throw new Error('No tienes permisos para subir archivos.');
      } else if (error.message.includes('network')) {
        throw new Error('Error de conexión. Verifica tu conexión a internet.');
      } else if (error.message.includes('unauthorized')) {
        throw new Error('No autorizado para realizar esta acción.');
      }
      throw new Error(`Error al subir las fotos de bautismo: ${error.message}`);
    }

    throw new Error('Error desconocido al subir las fotos de bautismo');
  }
}

// Get a specific member by ID
export async function getMemberById(memberId: string): Promise<Member | null> {
  try {
    // Get firestore instance
    const db = getFirestoreInstance();
    const membersCollection = collection(db, 'c_miembros');
    const memberRef = doc(membersCollection, memberId);
    const memberDoc = await getDoc(memberRef);

    if (!memberDoc.exists()) {
      return null;
    }

    const memberData = memberDoc.data();

    // Ensure status has a default value if missing
    const processedMemberData = memberData ? {
      ...memberData,
      status: normalizeMemberStatus(memberData.status)
    } : {};

    return {
      id: memberDoc.id,
      ...processedMemberData
    } as Member;
  } catch (error) {
    console.error('Error getting member by ID:', error);

    if (error instanceof Error) {
      if (error.message.includes('permission-denied')) {
        throw new Error('No tienes permisos para acceder a los miembros.');
      } else if (error.message.includes('network')) {
        throw new Error('Error de conexión. Verifica tu conexión a internet.');
      } else if (error.message.includes('not-found')) {
        return null; // Member not found
      }
      throw new Error(`Error al obtener el miembro: ${error.message}`);
    }

    throw new Error('Error desconocido al obtener el miembro');
  }
}

// Search for members by exact first name and last name (case insensitive)
export async function searchMembersByName(firstName: string, lastName: string, barrioOrg?: string): Promise<Member[]> {
  try {
    // Fail closed: never search members across all barrios
    if (!barrioOrg) {
      console.warn('searchMembersByName called without barrioOrg — returning empty');
      return [];
    }
    // Get firestore instance
    const db = getFirestoreInstance();
    const membersCollection = collection(db, 'c_miembros');

    if (!firstName?.trim() || !lastName?.trim()) {
      return [];
    }

    const constraints1: QueryConstraint[] = [
      where('barrioOrg', '==', barrioOrg),
      where('firstName', '==', firstName.trim()),
      where('lastName', '==', lastName.trim()),
    ];

    const constraints2: QueryConstraint[] = [
      where('barrioOrg', '==', barrioOrg),
      where('firstName', '==', lastName.trim()),
      where('lastName', '==', firstName.trim()),
    ];

    const q1 = query(membersCollection, ...constraints1);
    const q2 = query(membersCollection, ...constraints2);

    const [snapshot1, snapshot2] = await Promise.all([getDocs(q1), getDocs(q2)]);

    const members: Member[] = [];

    // Process first query results
    snapshot1.forEach((doc) => {
      const memberData = doc.data();
      const processedMemberData = {
        ...memberData,
        status: normalizeMemberStatus(memberData.status)
      };
      members.push({
        id: doc.id,
        ...processedMemberData
      } as Member);
    });

    // Process second query results (avoid duplicates)
    snapshot2.forEach((doc) => {
      if (!members.some(m => m.id === doc.id)) {
        const memberData = doc.data();
        const processedMemberData = {
          ...memberData,
          status: normalizeMemberStatus(memberData.status)
        };
        members.push({
          id: doc.id,
          ...processedMemberData
        } as Member);
      }
    });

    return members;
  } catch (error) {
    console.error('Error searching members by name:', error);

    if (error instanceof Error) {
      if (error.message.includes('permission-denied')) {
        throw new Error('No tienes permisos para buscar miembros.');
      } else if (error.message.includes('network')) {
        throw new Error('Error de conexión. Verifica tu conexión a internet.');
      }
      throw new Error(`Error al buscar miembros: ${error.message}`);
    }

    throw new Error('Error desconocido al buscar miembros');
  }
}
