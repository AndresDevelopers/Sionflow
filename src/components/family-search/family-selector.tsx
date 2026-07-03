'use client';

import { useState, useEffect } from 'react';
import { getMembersForSelector } from '@/lib/members-data';
import { useAuth } from '@/contexts/auth-context';
import type { Member } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, UserPlus } from 'lucide-react';

interface FamilySelectorProps {
  onFamilySelect: (data: { familyName: string; memberId?: string; memberName?: string }) => void;
  disabled?: boolean;
}

export function FamilySelector({ onFamilySelect, disabled = false }: FamilySelectorProps) {
  const { barrioOrg } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectionType, setSelectionType] = useState<'existing' | 'manual'>('existing');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [manualFamilyName, setManualFamilyName] = useState('');

  useEffect(() => {
    const fetchMembers = async () => {
      try {
        const membersData = await getMembersForSelector(false, barrioOrg);
        setMembers(membersData);
      } catch (error) {
        console.error('Error fetching members:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMembers();
  }, []);

  const handleSubmit = () => {
    if (selectionType === 'existing' && selectedMemberId) {
      const selectedMember = members.find(m => m.id === selectedMemberId);
      if (selectedMember) {
        const familyName = `Familia ${selectedMember.lastName}`;
        const memberName = `${selectedMember.firstName} ${selectedMember.lastName}`;
        onFamilySelect({
          familyName,
          memberId: selectedMember.id,
          memberName
        });
      }
    } else if (selectionType === 'manual' && manualFamilyName.trim()) {
      onFamilySelect({
        familyName: manualFamilyName.trim()
      });
    }
  };

  const isValid = 
    (selectionType === 'existing' && selectedMemberId) ||
    (selectionType === 'manual' && manualFamilyName.trim());

  return (
    <div className="space-y-4">
      <RadioGroup
        value={selectionType}
        onValueChange={(value) => setSelectionType(value as 'existing' | 'manual')}
        disabled={disabled}
      >
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="existing" id="existing" />
          <Label htmlFor="existing" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Seleccionar miembro existente
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="manual" id="manual" />
          <Label htmlFor="manual" className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Agregar familia manualmente
          </Label>
        </div>
      </RadioGroup>

      {selectionType === 'existing' && (
        <div className="space-y-2">
          <Label htmlFor="member-select">Seleccionar Miembro</Label>
          {loading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select
              value={selectedMemberId}
              onValueChange={setSelectedMemberId}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un miembro..." />
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.firstName} {member.lastName}
                    {member.status === 'less_active' && (
                      <span className="text-muted-foreground ml-2">(Menos activo)</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedMemberId && (
            <p className="text-sm text-muted-foreground">
              Se agregará como: <strong>Familia {members.find(m => m.id === selectedMemberId)?.lastName}</strong>
            </p>
          )}
        </div>
      )}

      {selectionType === 'manual' && (
        <div className="space-y-2">
          <Label htmlFor="manual-family-name">Nombre de la Familia</Label>
          <Input
            id="manual-family-name"
            value={manualFamilyName}
            onChange={(e) => setManualFamilyName(e.target.value)}
            placeholder="Ej: Familia García"
            disabled={disabled}
          />
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={!isValid || disabled}
        className="w-full"
      >
        Agregar Familia
      </Button>
    </div>
  );
}