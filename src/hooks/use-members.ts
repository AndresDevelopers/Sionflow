import { useState, useEffect } from 'react';
import { collection, getDocs, Firestore, DocumentData } from 'firebase/firestore';
import { firestore } from '@/lib/firebase';

type Member = {
  id: string;
  name: string;
  // Add other member fields as needed
};

export function useMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!firestore) return;
    
    const fetchMembers = async () => {
      try {
        const membersCollection = collection(firestore as Firestore, 'members');
        const snapshot = await getDocs(membersCollection);
        const membersData = snapshot.docs.map(doc => {
          const data = doc.data() as DocumentData;
          return {
            id: doc.id,
            name: data.name || 'Nombre no disponible',
            // Add other member fields as needed
          };
        }) as Member[];
        setMembers(membersData);
      } catch (err) {
        console.error('Error fetching members:', err);
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    fetchMembers();
  }, []);

  return { members, loading, error };
}
