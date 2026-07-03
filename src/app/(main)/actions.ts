
'use server';

import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  orderBy,
  deleteDoc,
  getDoc
} from 'firebase/firestore';
import { revalidatePath } from 'next/cache';
import { annotationsCollection } from '@/lib/collections';
import type { Annotation } from '@/lib/types';
import logger from '@/lib/logger';
