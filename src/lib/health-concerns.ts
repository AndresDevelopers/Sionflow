import {
  addDoc,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  orderBy,
  query,
  where,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { healthConcernsCollection, storage } from './collections';
import type { HealthConcern } from './types';

type UploadResult = {
  photoURL: string;
  photoPath: string;
};

export type HealthConcernInput = {
  firstName: string;
  lastName: string;
  helperIds: string[];
  helperNames: string[];
  address: string;
  observation: string;
  createdBy: string;
  barrioOrg: string;
  photoFile?: File | null;
};

export type HealthConcernUpdateInput = {
  concern: HealthConcern;
  firstName: string;
  lastName: string;
  helperIds: string[];
  helperNames: string[];
  address: string;
  observation: string;
  performedBy: string;
  photoFile?: File | null;
  removePhoto?: boolean;
};

const sanitizeFileName = (name: string) => {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
};

const uploadPhoto = async (file: File, userId: string): Promise<UploadResult> => {
  const safeName = sanitizeFileName(file.name || `salud-${Date.now()}.jpg`);
  const storagePath = `health-concerns/${userId}/${Date.now()}-${safeName}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file);
  const photoURL = await getDownloadURL(storageRef);
  return { photoURL, photoPath: storagePath };
};

export const fetchHealthConcerns = async (barrioOrg: string): Promise<HealthConcern[]> => {
  const q = query(healthConcernsCollection, where('barrioOrg', '==', barrioOrg), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as HealthConcern));
};

export const createHealthConcern = async (
  input: HealthConcernInput
): Promise<HealthConcern> => {
  const now = Timestamp.now();
  let uploadResult: UploadResult | undefined;

  if (input.photoFile) {
    uploadResult = await uploadPhoto(input.photoFile, input.createdBy);
  }

  const data: Record<string, unknown> = {
    firstName: input.firstName,
    lastName: input.lastName,
    helperIds: input.helperIds,
    helperNames: input.helperNames,
    address: input.address,
    observation: input.observation,
    createdBy: input.createdBy,
    barrioOrg: input.barrioOrg,
    createdAt: now,
    updatedAt: now,
  };

  if (uploadResult) {
    data.photoURL = uploadResult.photoURL;
    data.photoPath = uploadResult.photoPath;
  }

  const docRef = await addDoc(healthConcernsCollection, data);

  return {
    id: docRef.id,
    firstName: input.firstName,
    lastName: input.lastName,
    helperIds: input.helperIds,
    helperNames: input.helperNames,
    address: input.address,
    observation: input.observation,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    photoURL: uploadResult?.photoURL,
    photoPath: uploadResult?.photoPath,
  };
};

export const deleteHealthConcern = async (
  id: string,
  photoPath?: string | null
): Promise<void> => {
  const docRef = doc(healthConcernsCollection, id);
  await deleteDoc(docRef);

  if (photoPath) {
    try {
      const storageRef = ref(storage, photoPath);
      await deleteObject(storageRef);
    } catch (error) {
      console.error('Error removing health concern photo:', error);
    }
  }
};

export const updateHealthConcern = async (
  input: HealthConcernUpdateInput
): Promise<HealthConcern> => {
  const now = Timestamp.now();
  const docRef = doc(healthConcernsCollection, input.concern.id);

  let uploadResult: UploadResult | undefined;

  if (input.photoFile) {
    uploadResult = await uploadPhoto(input.photoFile, input.performedBy);

    if (input.concern.photoPath) {
      try {
        const storageRef = ref(storage, input.concern.photoPath);
        await deleteObject(storageRef);
      } catch (error) {
        console.error('Error replacing health concern photo:', error);
      }
    }
  } else if (input.removePhoto && input.concern.photoPath) {
    try {
      const storageRef = ref(storage, input.concern.photoPath);
      await deleteObject(storageRef);
    } catch (error) {
      console.error('Error removing health concern photo:', error);
    }
  }

  const data: Record<string, unknown> = {
    firstName: input.firstName,
    lastName: input.lastName,
    helperIds: input.helperIds,
    helperNames: input.helperNames,
    address: input.address,
    observation: input.observation,
    updatedAt: now,
  };

  if (uploadResult) {
    data.photoURL = uploadResult.photoURL;
    data.photoPath = uploadResult.photoPath;
  } else if (input.removePhoto) {
    data.photoURL = deleteField();
    data.photoPath = deleteField();
  }

  await updateDoc(docRef, data);

  return {
    ...input.concern,
    firstName: input.firstName,
    lastName: input.lastName,
    helperIds: input.helperIds,
    helperNames: input.helperNames,
    address: input.address,
    observation: input.observation,
    updatedAt: now,
    photoURL: uploadResult?.photoURL ?? (input.removePhoto ? undefined : input.concern.photoURL),
    photoPath: uploadResult?.photoPath ?? (input.removePhoto ? undefined : input.concern.photoPath),
  };
};
