'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronsUpDown, Users, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import type { Member, MemberStatus } from '@/lib/types';
import { getMembersForSelector } from '@/lib/members-data';

interface MemberSelectorProps {
  value?: string; // Member ID
  onValueChange: (memberId: string | undefined, member: Member | null) => void;
  placeholder?: string;
  includeInactive?: boolean;
  statusFilter?: MemberStatus[];
  disabled?: boolean;
  className?: string;
  showStatus?: boolean;
  allowClear?: boolean;
}

const statusConfig = {
  active: {
    label: 'Activo',
    variant: 'default' as const,
    color: 'text-green-600'
  },
  less_active: {
    label: 'Menos Activo',
    variant: 'secondary' as const,
    color: 'text-yellow-600'
  },
  inactive: {
    label: 'Inactivo',
    variant: 'destructive' as const,
    color: 'text-red-600'
  },
  deceased: {
    label: 'Fallecido',
    variant: 'secondary' as const,
    color: 'text-muted-foreground'
  }
};

export function MemberSelector({
  value,
  onValueChange,
  placeholder = 'Seleccionar miembro...',
  includeInactive = false,
  statusFilter,
  disabled = false,
  className,
  showStatus = true,
  allowClear = true,
}: MemberSelectorProps) {
  const { toast } = useToast();
  const { barrioOrg } = useAuth();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const allMembers = await getMembersForSelector(includeInactive, barrioOrg);
      
      // Apply status filter if provided
      const filteredMembers = statusFilter 
        ? allMembers.filter(member => statusFilter.includes(member.status))
        : allMembers;
      
      setMembers(filteredMembers);
      
      // Find and set selected member if value is provided
      if (value) {
        const member = filteredMembers.find(m => m.id === value);
        setSelectedMember(member || null);
      }
    } catch (error) {
      console.error('Error fetching members:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los miembros.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }, [includeInactive, statusFilter, toast, value]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleSelect = (memberId: string) => {
    const member = members.find(m => m.id === memberId);
    if (member) {
      setSelectedMember(member);
      onValueChange(memberId, member);
    }
    setOpen(false);
  };

  const handleClear = () => {
    setSelectedMember(null);
    onValueChange(undefined, null);
  };

  const getDisplayName = (member: Member) => {
    return `${member.firstName} ${member.lastName}`;
  };

  const getInitials = (member: Member) => {
    return `${member.firstName[0]?.toUpperCase() || ''}${member.lastName[0]?.toUpperCase() || ''}`;
  };

  if (loading) {
    return (
      <div className={cn('flex items-center space-x-2', className)}>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="flex-1 justify-between"
            disabled={disabled}
          >
            {selectedMember ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={selectedMember.photoURL || undefined} />
                  <AvatarFallback className="text-xs">
                    {getInitials(selectedMember)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{getDisplayName(selectedMember)}</span>
                {showStatus && (
                  <Badge 
                    variant={statusConfig[selectedMember.status].variant}
                    className="ml-auto text-xs"
                  >
                    {statusConfig[selectedMember.status].label}
                  </Badge>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4" />
                <span>{placeholder}</span>
              </div>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <Command>
            <CommandInput 
              placeholder="Buscar miembro..." 
              className="h-9"
            />
            <CommandList>
              <CommandEmpty>
                <div className="flex flex-col items-center gap-2 py-6">
                  <Search className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No se encontraron miembros.
                  </p>
                </div>
              </CommandEmpty>
              <CommandGroup>
                {members.map((member) => {
                  const statusInfo = statusConfig[member.status];
                  
                  return (
                    <CommandItem
                      key={member.id}
                      value={`${member.firstName} ${member.lastName} ${member.id}`}
                      onSelect={() => handleSelect(member.id)}
                      className="flex items-center gap-2 p-2"
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={member.photoURL || undefined} />
                        <AvatarFallback className="text-xs">
                          {getInitials(member)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {getDisplayName(member)}
                        </p>
                        {member.phoneNumber && (
                          <p className="text-xs text-muted-foreground truncate">
                            {member.phoneNumber}
                          </p>
                        )}
                      </div>
                      {showStatus && (
                        <Badge 
                          variant={statusInfo.variant}
                          className="text-xs"
                        >
                          {statusInfo.label}
                        </Badge>
                      )}
                      <Check
                        className={cn(
                          'ml-2 h-4 w-4',
                          value === member.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      
      {allowClear && selectedMember && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={disabled}
          className="px-2"
        >
          ×
        </Button>
      )}
    </div>
  );
}

// Hook to get member data by ID
export function useMemberData(memberId?: string) {
  const { barrioOrg } = useAuth();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      if (!memberId) {
        setMember(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      getMembersForSelector(true, barrioOrg)
        .then(members => {
          const foundMember = members.find(m => m.id === memberId);
          setMember(foundMember || null);
        })
        .catch(error => {
          console.error('Error fetching member data:', error);
          setMember(null);
        })
        .finally(() => {
          setLoading(false);
        });
    });
  }, [memberId]);

  return { member, loading };
}

// Utility function to auto-fill form fields from member data
export function fillFormFromMember(
  member: Member | null,
  setValue: (name: string, value: any) => void,
  fieldMappings: Record<string, keyof Member> = {
    firstName: 'firstName',
    lastName: 'lastName',
    phoneNumber: 'phoneNumber',
    photoURL: 'photoURL'
  }
) {
  if (!member) {
    // Clear fields if no member selected
    Object.keys(fieldMappings).forEach(fieldName => {
      setValue(fieldName, '');
    });
    return;
  }

  // Fill fields with member data
  Object.entries(fieldMappings).forEach(([fieldName, memberProperty]) => {
    const value = member[memberProperty];
    if (value !== null && value !== undefined) {
      setValue(fieldName, value);
    }
  });
}

// Component for displaying member info in read-only mode
interface MemberDisplayProps {
  member: Member;
  showStatus?: boolean;
  showPhone?: boolean;
  className?: string;
}

export function MemberDisplay({ 
  member, 
  showStatus = true, 
  showPhone = false,
  className 
}: MemberDisplayProps) {
  const statusInfo = statusConfig[member.status];
  
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Avatar className="h-10 w-10">
        <AvatarImage src={member.photoURL || undefined} />
        <AvatarFallback>
          {member.firstName[0]?.toUpperCase()}
          {member.lastName[0]?.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">
          {member.firstName} {member.lastName}
        </p>
        {showPhone && member.phoneNumber && (
          <p className="text-sm text-muted-foreground truncate">
            {member.phoneNumber}
          </p>
        )}
      </div>
      {showStatus && (
        <Badge variant={statusInfo.variant}>
          {statusInfo.label}
        </Badge>
      )}
    </div>
  );
}
