'use client';

import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Member {
  id: string;
  name: string;
}

interface MemberSelectorProps {
  members: Member[];
  onSelect: (member: Member) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function MemberSelector({ 
  members, 
  onSelect, 
  placeholder = 'Buscar miembro...',
  disabled = false,
  className = ''
}: MemberSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter members based on search term
  const filteredMembers = members.filter(member =>
    member.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (member: Member) => {
    onSelect(member);
    setSearchTerm('');
    setIsOpen(false);
  };

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <div className="relative">
        <Input
          type="text"
          placeholder={placeholder}
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          disabled={disabled}
          className="w-full"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
        >
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
      
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg">
          {filteredMembers.length > 0 ? (
            <ul className="max-h-60 overflow-auto py-1">
              {filteredMembers.map((member) => (
                <li key={member.id}>
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center"
                    onClick={() => handleSelect(member)}
                  >
                    {member.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No se encontraron miembros
            </div>
          )}
        </div>
      )}
    </div>
  );
}
