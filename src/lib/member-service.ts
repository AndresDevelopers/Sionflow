/**
 * Service layer para operaciones de miembros
 * Separa la lógica de negocio de los componentes UI
 */

import { Timestamp, collection, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { firestore } from './firebase';
import { uploadMemberPhoto, uploadBaptismPhotos } from './members-data';
import { syncMinisteringAssignments } from './ministering-sync';
import { ref, deleteObject } from 'firebase/storage';
import { storage } from './firebase';
import type { Member } from './types';

export interface MemberFormData {
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  email?: string;
  birthDate?: Date;
  baptismDate?: Date;
  deathDate?: Date;
  status: 'active' | 'less_active' | 'inactive' | 'deceased';
  photoURL?: string;
  baptismPhotos?: string[];
  ordinances?: string[];
  ministeringTeachers?: string[];
}

export interface PhotoUploadData {
  photoFile: File | null;
  photoPreview: string | null;
  baptismPhotoFiles: File[];
  baptismPhotoPreviews: string[];
}

export interface MemberUpdateResult {
  success: boolean;
  memberId: string;
  message: string;
}

/**
 * Maneja la subida de fotos del miembro
 */
export async function handleMemberPhotoUpload(
  photoData: PhotoUploadData,
  existingMember: Member | null,
  userId: string
): Promise<string | null> {
  let photoURL = existingMember?.photoURL;

  if (photoData.photoFile) {
    // Subir nueva foto
    photoURL = await uploadMemberPhoto(photoData.photoFile, userId);
  } else if (photoData.photoPreview === null && existingMember?.photoURL) {
    // Foto fue removida - eliminar del storage
    await deletePhotoFromStorage(existingMember.photoURL);
    photoURL = null as any;
  }

  return photoURL as any;
}

/**
 * Maneja la subida de fotos de bautismo
 */
export async function handleBaptismPhotosUpload(
  photoData: PhotoUploadData,
  existingMember: Member | null,
  userId: string
): Promise<string[]> {
  let baptismPhotoURLs: string[] = [];

  if (photoData.baptismPhotoFiles.length > 0) {
    const uploadedPhotos = await uploadBaptismPhotos(photoData.baptismPhotoFiles, userId);
    
    // Mantener fotos existentes que no fueron eliminadas
    if (existingMember?.baptismPhotos) {
      const existingPhotos = existingMember.baptismPhotos.filter(url =>
        photoData.baptismPhotoPreviews.includes(url)
      );
      baptismPhotoURLs = [...existingPhotos, ...uploadedPhotos];
    } else {
      baptismPhotoURLs = uploadedPhotos;
    }
  } else {
    // Mantener fotos existentes
    baptismPhotoURLs = existingMember?.baptismPhotos || [];
  }

  // Eliminar fotos que fueron removidas
  if (existingMember?.baptismPhotos) {
    const photosToDelete = existingMember.baptismPhotos.filter(url =>
      !photoData.baptismPhotoPreviews.includes(url)
    );
    
    await Promise.all(
      photosToDelete.map(url => deletePhotoFromStorage(url))
    );
  }

  return baptismPhotoURLs;
}

/**
 * Elimina una foto del storage de Firebase
 */
async function deletePhotoFromStorage(photoURL: string): Promise<void> {
  try {
    if (photoURL.startsWith('https://firebasestorage.googleapis.com')) {
      const photoRef = ref(storage, photoURL);
      await deleteObject(photoRef);
      console.log('✅ Photo deleted from storage');
    }
  } catch (error) {
    console.warn('⚠️ Could not delete photo from storage:', error);
    // No lanzar error para no interrumpir el flujo
  }
}

/**
 * @deprecated Los conversos recientes se derivan solo de c_miembros.baptismDate.
 * No se crean registros en c_conversos. Se mantiene por compatibilidad de imports.
 */
export async function createConvertRecords(
  _formData: MemberFormData,
  _photoURL: string | null,
  _baptismPhotoURLs: string[],
  _userId: string,
  _barrioOrg: string,
  _memberId?: string
): Promise<string | null> {
  return null;
}

/**
 * Elimina registros automáticos de bautismo cuando la fecha cambia o se elimina
 */
export async function cleanupBaptismRecords(
  memberName: string,
  baptismYearChanged: boolean,
  baptismDateRemoved: boolean,
  barrioOrg: string
): Promise<void> {
  if (!baptismYearChanged && !baptismDateRemoved) return;

  const baptismQuery = query(
    collection(firestore, 'c_bautismos'),
    where('barrioOrg', '==', barrioOrg),
    where('name', '==', memberName),
    where('source', '==', 'Automático')
  );

  const existingBaptisms = await getDocs(baptismQuery);
  await Promise.all(
    existingBaptisms.docs.map(baptismDoc =>
      deleteDoc(doc(firestore, 'c_bautismos', baptismDoc.id))
    )
  );
}

/**
 * Elimina registros de converso y bautismos automáticos ligados a un miembro.
 * Se usa cuando se quita o cambia la fecha de bautismo para que Conversos
 * refleje automáticamente lo que hay en el miembro.
 */
export async function cleanupConvertAndBaptismRecords(options: {
  memberId?: string;
  memberName: string;
  barrioOrg: string;
}): Promise<void> {
  const { memberId, memberName, barrioOrg } = options;
  const convertDocsToDelete = new Map<string, true>();

  if (memberId) {
    const byMemberId = await getDocs(
      query(
        collection(firestore, 'c_conversos'),
        where('barrioOrg', '==', barrioOrg),
        where('memberId', '==', memberId)
      )
    );
    byMemberId.docs.forEach((d) => convertDocsToDelete.set(d.id, true));
  }

  // También por nombre: registros automáticos antiguos pueden no tener memberId
  if (memberName.trim()) {
    const byName = await getDocs(
      query(
        collection(firestore, 'c_conversos'),
        where('barrioOrg', '==', barrioOrg),
        where('name', '==', memberName.trim())
      )
    );
    byName.docs.forEach((d) => {
      const data = d.data();
      const isAuto =
        data.observation === 'Registrado automáticamente desde Miembros' ||
        data.missionaryReference === 'Registro de miembros' ||
        (memberId && data.memberId === memberId) ||
        !data.memberId ||
        data.memberId === '';
      if (isAuto) {
        convertDocsToDelete.set(d.id, true);
      }
    });
  }

  await Promise.all(
    [...convertDocsToDelete.keys()].map((id) =>
      deleteDoc(doc(firestore, 'c_conversos', id))
    )
  );

  if (memberName.trim()) {
    const baptismQuery = query(
      collection(firestore, 'c_bautismos'),
      where('barrioOrg', '==', barrioOrg),
      where('name', '==', memberName.trim()),
      where('source', '==', 'Automático')
    );
    const existingBaptisms = await getDocs(baptismQuery);
    await Promise.all(
      existingBaptisms.docs.map((baptismDoc) =>
        deleteDoc(doc(firestore, 'c_bautismos', baptismDoc.id))
      )
    );
  }
}

/**
 * Indica si un miembro con esa fecha de bautismo debe figurar como converso reciente (últimos 24 meses).
 */
export function isRecentConvertBaptism(baptismDate?: Date | null): boolean {
  if (!baptismDate) return false;
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  return baptismDate >= twoYearsAgo;
}

/**
 * Sincroniza las asignaciones de ministración si cambiaron
 */
export async function syncMinisteringIfChanged(
  member: Member,
  previousTeachers: string[],
  currentTeachers: string[],
  barrioOrg: string
): Promise<void> {
  if (JSON.stringify(previousTeachers.sort()) === JSON.stringify(currentTeachers.sort())) {
    return; // No hay cambios
  }

  try {
    await syncMinisteringAssignments(member, previousTeachers, barrioOrg);
    console.log('✅ Ministering assignments synced');
  } catch (error) {
    console.error('⚠️ Error syncing ministering assignments:', error);
    // No lanzar error para no interrumpir el flujo principal
  }
}

/**
 * Prepara los datos del miembro para enviar a la API
 */
export function prepareMemberDataForAPI(
  formData: MemberFormData,
  photoURL: string | null,
  baptismPhotoURLs: string[]
) {
  return {
    firstName: formData.firstName.trim(),
    lastName: formData.lastName.trim(),
    status: formData.status,
    phoneNumber: formData.phoneNumber?.trim() || undefined,
    birthDate: formData.birthDate?.toISOString(),
    baptismDate: formData.baptismDate?.toISOString(),
    deathDate: formData.deathDate?.toISOString(),
    photoURL: photoURL as any,
    baptismPhotos: baptismPhotoURLs,
    ordinances: formData.ordinances || [],
    ministeringTeachers: formData.ministeringTeachers || [],
  };
}
