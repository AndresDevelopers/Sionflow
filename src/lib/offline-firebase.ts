'use client';

import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  QueryConstraint,
  DocumentData,
  CollectionReference,
  DocumentReference,
  Timestamp
} from 'firebase/firestore';
import { firestore } from './firebase';

// Local storage keys
const OFFLINE_DATA_KEY = 'quorumflow_offline_data';
const OFFLINE_OPERATIONS_KEY = 'quorumflow_offline_operations';

interface OfflineOperation {
  id: string;
  type: 'add' | 'update' | 'delete';
  collection: string;
  docId?: string;
  data?: any;
  timestamp: number;
}

interface CachedData {
  [collectionName: string]: {
    [docId: string]: {
      data: any;
      timestamp: number;
    }
  }
}

class OfflineFirebaseManager {
  private isOnline: boolean = true;
  private cachedData: CachedData = {};
  private pendingOperations: OfflineOperation[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      this.isOnline = navigator.onLine;
      this.loadCachedData();
      this.loadPendingOperations();
      
      // Listen for online/offline events
      window.addEventListener('online', this.handleOnline.bind(this));
      window.addEventListener('offline', this.handleOffline.bind(this));
    }
  }

  private handleOnline() {
    this.isOnline = true;
    console.log('[OfflineFirebase] Back online, syncing pending operations');
    this.syncPendingOperations();
  }

  private handleOffline() {
    this.isOnline = false;
    console.log('[OfflineFirebase] Gone offline, operations will be queued');
  }

  private loadCachedData() {
    try {
      const cached = localStorage.getItem(OFFLINE_DATA_KEY);
      if (cached) {
        this.cachedData = JSON.parse(cached);
      }
    } catch (error) {
      console.error('[OfflineFirebase] Failed to load cached data:', error);
    }
  }

  private saveCachedData() {
    try {
      localStorage.setItem(OFFLINE_DATA_KEY, JSON.stringify(this.cachedData));
    } catch (error) {
      console.error('[OfflineFirebase] Failed to save cached data:', error);
    }
  }

  private loadPendingOperations() {
    try {
      const pending = localStorage.getItem(OFFLINE_OPERATIONS_KEY);
      if (pending) {
        this.pendingOperations = JSON.parse(pending);
      }
    } catch (error) {
      console.error('[OfflineFirebase] Failed to load pending operations:', error);
    }
  }

  private savePendingOperations() {
    try {
      localStorage.setItem(OFFLINE_OPERATIONS_KEY, JSON.stringify(this.pendingOperations));
    } catch (error) {
      console.error('[OfflineFirebase] Failed to save pending operations:', error);
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private cacheDocument(collectionName: string, docId: string, data: any) {
    if (!this.cachedData[collectionName]) {
      this.cachedData[collectionName] = {};
    }
    
    this.cachedData[collectionName][docId] = {
      data,
      timestamp: Date.now()
    };
    
    this.saveCachedData();
  }

  private getCachedDocument(collectionName: string, docId: string) {
    return this.cachedData[collectionName]?.[docId];
  }

  private getCachedCollection(collectionName: string) {
    return this.cachedData[collectionName] || {};
  }

  private queueOperation(operation: OfflineOperation) {
    this.pendingOperations.push(operation);
    this.savePendingOperations();
    console.log('[OfflineFirebase] Operation queued:', operation);
  }

  private async syncPendingOperations() {
    if (!this.isOnline || this.pendingOperations.length === 0) {
      return;
    }

    console.log('[OfflineFirebase] Syncing', this.pendingOperations.length, 'pending operations');
    
    const operations = [...this.pendingOperations];
    this.pendingOperations = [];
    this.savePendingOperations();

    for (const operation of operations) {
      try {
        await this.executePendingOperation(operation);
        console.log('[OfflineFirebase] Successfully synced operation:', operation.id);
      } catch (error) {
        console.error('[OfflineFirebase] Failed to sync operation:', operation.id, error);
        // Re-queue failed operation
        this.pendingOperations.push(operation);
      }
    }

    if (this.pendingOperations.length > 0) {
      this.savePendingOperations();
    }
  }

  private async executePendingOperation(operation: OfflineOperation) {
    const collectionRef = collection(firestore, operation.collection);

    switch (operation.type) {
      case 'add':
        await addDoc(collectionRef, operation.data);
        break;
      
      case 'update':
        if (operation.docId) {
          const docRef = doc(collectionRef, operation.docId);
          await updateDoc(docRef, operation.data);
        }
        break;
      
      case 'delete':
        if (operation.docId) {
          const docRef = doc(collectionRef, operation.docId);
          await deleteDoc(docRef);
        }
        break;
    }
  }

  // Public methods that mirror Firebase API

  async getDocs(q: any): Promise<any> {
    const collectionName = this.getCollectionNameFromQuery(q);
    
    try {
      if (this.isOnline) {
        const snapshot = await getDocs(q);
        
        // Cache the results
        snapshot.docs.forEach(doc => {
          this.cacheDocument(collectionName, doc.id, doc.data());
        });
        
        return snapshot;
      }
    } catch (error) {
      console.log('[OfflineFirebase] Network request failed, using cache');
    }

    // Return cached data
    const cachedCollection = this.getCachedCollection(collectionName);
    const docs = Object.entries(cachedCollection).map(([id, cached]) => ({
      id,
      data: () => cached.data,
      exists: () => true
    }));

    return {
      docs,
      size: docs.length,
      empty: docs.length === 0
    };
  }

  async getDoc(docRef: DocumentReference): Promise<any> {
    const collectionName = docRef.parent.id;
    const docId = docRef.id;
    
    try {
      if (this.isOnline) {
        const snapshot = await getDoc(docRef);
        
        if (snapshot.exists()) {
          this.cacheDocument(collectionName, docId, snapshot.data());
        }
        
        return snapshot;
      }
    } catch (error) {
      console.log('[OfflineFirebase] Network request failed, using cache');
    }

    // Return cached data
    const cached = this.getCachedDocument(collectionName, docId);
    
    return {
      id: docId,
      data: () => cached?.data,
      exists: () => !!cached
    };
  }

  async addDoc(collectionRef: CollectionReference, data: DocumentData): Promise<DocumentReference> {
    const collectionName = collectionRef.id;
    const tempId = this.generateId();
    
    // Add timestamp if not present
    const dataWithTimestamp = {
      ...data,
      createdAt: data.createdAt || Timestamp.now(),
      updatedAt: Timestamp.now()
    };

    if (this.isOnline) {
      try {
        const docRef = await addDoc(collectionRef, dataWithTimestamp);
        this.cacheDocument(collectionName, docRef.id, dataWithTimestamp);
        return docRef;
      } catch (error) {
        console.log('[OfflineFirebase] Add failed, queuing operation');
      }
    }

    // Queue operation and cache optimistically
    this.queueOperation({
      id: tempId,
      type: 'add',
      collection: collectionName,
      data: dataWithTimestamp,
      timestamp: Date.now()
    });

    this.cacheDocument(collectionName, tempId, dataWithTimestamp);
    
    // Return a mock document reference
    return doc(collectionRef, tempId);
  }

  async updateDoc(docRef: DocumentReference, data: Partial<DocumentData>): Promise<void> {
    const collectionName = docRef.parent.id;
    const docId = docRef.id;
    
    // Add timestamp
    const dataWithTimestamp = {
      ...data,
      updatedAt: Timestamp.now()
    };

    if (this.isOnline) {
      try {
        await updateDoc(docRef, dataWithTimestamp);
        
        // Update cache
        const cached = this.getCachedDocument(collectionName, docId);
        if (cached) {
          this.cacheDocument(collectionName, docId, { ...cached.data, ...dataWithTimestamp });
        }
        return;
      } catch (error) {
        console.log('[OfflineFirebase] Update failed, queuing operation');
      }
    }

    // Queue operation and update cache optimistically
    this.queueOperation({
      id: this.generateId(),
      type: 'update',
      collection: collectionName,
      docId,
      data: dataWithTimestamp,
      timestamp: Date.now()
    });

    const cached = this.getCachedDocument(collectionName, docId);
    if (cached) {
      this.cacheDocument(collectionName, docId, { ...cached.data, ...dataWithTimestamp });
    }
  }

  async deleteDoc(docRef: DocumentReference): Promise<void> {
    const collectionName = docRef.parent.id;
    const docId = docRef.id;

    if (this.isOnline) {
      try {
        await deleteDoc(docRef);
        
        // Remove from cache
        if (this.cachedData[collectionName]) {
          delete this.cachedData[collectionName][docId];
          this.saveCachedData();
        }
        return;
      } catch (error) {
        console.log('[OfflineFirebase] Delete failed, queuing operation');
      }
    }

    // Queue operation and remove from cache optimistically
    this.queueOperation({
      id: this.generateId(),
      type: 'delete',
      collection: collectionName,
      docId,
      timestamp: Date.now()
    });

    if (this.cachedData[collectionName]) {
      delete this.cachedData[collectionName][docId];
      this.saveCachedData();
    }
  }

  private getCollectionNameFromQuery(q: any): string {
    // Extract collection name from query - this is a simplified approach
    // In a real implementation, you'd need to parse the query more thoroughly
    return q._query?.path?.segments?.[0] || 'unknown';
  }

  // Get pending operations count
  getPendingOperationsCount(): number {
    return this.pendingOperations.length;
  }

  // Force sync
  async forcSync(): Promise<void> {
    await this.syncPendingOperations();
  }
}

// Export singleton instance
export const offlineFirebase = new OfflineFirebaseManager();

// Export wrapped functions that use offline manager
export const offlineGetDocs = (q: any) => offlineFirebase.getDocs(q);
export const offlineGetDoc = (docRef: DocumentReference) => offlineFirebase.getDoc(docRef);
export const offlineAddDoc = (collectionRef: CollectionReference, data: DocumentData) => 
  offlineFirebase.addDoc(collectionRef, data);
export const offlineUpdateDoc = (docRef: DocumentReference, data: Partial<DocumentData>) => 
  offlineFirebase.updateDoc(docRef, data);
export const offlineDeleteDoc = (docRef: DocumentReference) => offlineFirebase.deleteDoc(docRef);