'use server';

import { doc, updateDoc } from 'firebase/firestore';
import { revalidatePath } from 'next/cache';
import { firestore } from '@/lib/firebase';
import logger from '@/lib/logger';
