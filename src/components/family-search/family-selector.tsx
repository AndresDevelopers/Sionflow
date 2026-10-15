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
import { useI18n } from '@/contexts/i18n-context';

interface FamilySelectorProps {
  onFamilySelect: (data: { familyName: string; memberId?: string; memberName?: string }) => void;
  disabled?: boolean;
}

export function FamilySelector({ onFamilySelect, disabled = false }: FamilySelectorProps) {
  const { t } = useI18n();
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
  }, [barrioOrg]);

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
            {t('familySearch.selector.selectExisting')}
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="manual" id="manual" />
          <Label htmlFor="manual" className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            {t('familySearch.selector.addManual')}
          </Label>
        </div>
      </RadioGroup>

      {selectionType === 'existing' && (
        <div className="space-y-2">
          <Label htmlFor="member-select">{t('familySearch.selector.selectMemberLabel')}</Label>
          {loading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select
              value={selectedMemberId}
              onValueChange={setSelectedMemberId}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('familySearch.selector.selectMember')} />
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.firstName} {member.lastName}
                    {member.status === 'less_active' && (
                      <span className="text-muted-foreground ml-2">{t('familySearch.selector.lessActive')}</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedMemberId && (
            <p className="text-sm text-muted-foreground">
              {t('familySearch.selector.willAddAs', {
                name: t('familySearch.selector.familyPrefix', {
                  lastName: members.find(m => m.id === selectedMemberId)?.lastName ?? '',
                }),
              })}
            </p>
          )}
        </div>
      )}

      {selectionType === 'manual' && (
        <div className="space-y-2">
          <Label htmlFor="manual-family-name">{t('familySearch.selector.familyNameLabel')}</Label>
          <Input
            id="manual-family-name"
            value={manualFamilyName}
            onChange={(e) => setManualFamilyName(e.target.value)}
            placeholder={t('familySearch.selector.manualPlaceholder')}
            disabled={disabled}
          />
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={!isValid || disabled}
        className="w-full"
      >
        {t('familySearch.selector.addFamily')}
      </Button>
    </div>
  );
}