'use client';

import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import Image from 'next/image';
import { PlusCircle, Trash2, UserPlus, Users } from 'lucide-react';
import { MemberSelector } from '@/components/members/member-selector';
import type { Convert, Member, NewConvertFriendship, Ordinance } from '@/lib/types';
import { useI18n } from '@/contexts/i18n-context';
import { getMemberPhotoURL } from '@/lib/converts-from-members';

// Extended convert type with additional info
export type ConvertWithInfo = Convert & {
  friendship?: NewConvertFriendship | null;
  memberData?: Member | null;
  ministeringTeachers?: string[];
  calling?: string;
  notes?: string;
  recommendationActive?: boolean;
  selfRelianceCourse?: boolean;
  memberId?: string;
};

// Convert Info Sheet Component
interface ConvertInfoSheetProps {
  convert: ConvertWithInfo | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (convertId: string, calling: string, notes: string, recommendationActive: boolean, selfRelianceCourse: boolean) => Promise<void>;
  onSaveFriends?: (convertId: string, convertName: string, friends: string[], friendshipId?: string) => Promise<void>;
  onSaveTeachers?: (memberId: string, teachers: string[], previousTeachers: string[]) => Promise<void>;
  saving: boolean;
  canWrite: boolean;
  availableMembers?: Member[];
}

export function ConvertInfoSheet({ 
  convert, 
  isOpen, 
  onOpenChange, 
  onSave, 
  onSaveFriends,
  onSaveTeachers,
  saving,
  canWrite,
  availableMembers = []
}: ConvertInfoSheetProps) {
  const { t } = useI18n();
  const [calling, setCalling] = useState(convert?.calling || '');
  const [notes, setNotes] = useState(convert?.notes || '');
  const [recommendationActive, setRecommendationActive] = useState(!!convert?.recommendationActive);
  const [selfRelianceCourse, setSelfRelianceCourse] = useState(!!convert?.selfRelianceCourse);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Edit mode states
  const [editingFriends, setEditingFriends] = useState(false);
  const [editingTeachers, setEditingTeachers] = useState(false);
  const [friendInputs, setFriendInputs] = useState<string[]>(['']);
  const [teacherInputs, setTeacherInputs] = useState<string[]>(['']);

  // Reset state when convert changes - using useLayoutEffect to avoid setState in render issues
  const currentConvertId = convert?.id;
  const prevConvertIdRef = useRef<string | undefined>(undefined);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    // Use a microtask to defer state updates to avoid synchronous setState during render
    const timeoutId = setTimeout(() => {
      if (currentConvertId !== prevConvertIdRef.current) {
        prevConvertIdRef.current = currentConvertId;
        setCalling(convert?.calling || '');
        setNotes(convert?.notes || '');
        setRecommendationActive(!!convert?.recommendationActive);
        setSelfRelianceCourse(!!convert?.selfRelianceCourse);
        setHasChanges(false);
        setEditingFriends(false);
        setEditingTeachers(false);
        // Initialize friend inputs
        if (convert?.friendship?.friends?.length) {
          setFriendInputs(convert.friendship.friends);
        } else {
          setFriendInputs(['']);
        }
        // Initialize teacher inputs
        if (convert?.ministeringTeachers?.length) {
          setTeacherInputs(convert.ministeringTeachers);
        } else {
          setTeacherInputs(['']);
        }
        setIsInitializing(false);
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [currentConvertId, convert?.calling, convert?.notes, convert?.recommendationActive, convert?.selfRelianceCourse, convert?.friendship?.friends, convert?.ministeringTeachers]);

  const handleCallingChange = (value: string) => {
    setCalling(value);
    setHasChanges(true);
  };

  const handleNotesChange = (value: string) => {
    setNotes(value);
    setHasChanges(true);
  };

  const handleRecommendationChange = (value: boolean) => {
    setRecommendationActive(value);
    setHasChanges(true);
  };

  const handleSelfRelianceCourseChange = (value: boolean) => {
    setSelfRelianceCourse(value);
    setHasChanges(true);
  };

  // Friend editing functions
  const handleAddFriendInput = () => {
    setFriendInputs([...friendInputs, '']);
  };

  const handleRemoveFriendInput = (index: number) => {
    const newInputs = friendInputs.filter((_, i) => i !== index);
    if (newInputs.length === 0) newInputs.push('');
    setFriendInputs(newInputs);
  };

  const handleFriendInputChange = (index: number, value: string) => {
    const newInputs = [...friendInputs];
    newInputs[index] = value;
    setFriendInputs(newInputs);
  };

  const handleSaveFriends = async () => {
    if (!convert || !onSaveFriends) return;
    const validFriends = friendInputs.filter(f => f.trim().length > 0);
    await onSaveFriends(
      convert.id, 
      convert.name, 
      validFriends, 
      convert.friendship?.id
    );
    setEditingFriends(false);
  };

  // Teacher editing functions
  const handleAddTeacherInput = () => {
    setTeacherInputs([...teacherInputs, '']);
  };

  const handleRemoveTeacherInput = (index: number) => {
    const newInputs = teacherInputs.filter((_, i) => i !== index);
    if (newInputs.length === 0) newInputs.push('');
    setTeacherInputs(newInputs);
  };

  const handleTeacherInputChange = (index: number, value: string) => {
    const newInputs = [...teacherInputs];
    newInputs[index] = value;
    setTeacherInputs(newInputs);
  };

  const handleSaveTeachers = async () => {
    if (!convert?.memberData?.id || !onSaveTeachers) return;
    const validTeachers = teacherInputs.filter(tchr => tchr.trim().length > 0);
    const previousTeachers = convert.ministeringTeachers || [];
    await onSaveTeachers(convert.memberData.id, validTeachers, previousTeachers);
    setEditingTeachers(false);
  };

  const handleSave = async () => {
    if (!convert) return;
    await onSave(convert.id, calling, notes, recommendationActive, selfRelianceCourse);
    setHasChanges(false);
  };

  if (!convert) return null;

  const ordinances = convert.memberData?.ordinances || [];
  const hasFriendship = !!convert.friendship && convert.friendship.friends.length > 0;
  const friendNames = convert.friendship?.friends || [];
  const teachers = convert.ministeringTeachers || [];
  const getFriendDisplayName = (friend: string) => {
    const id = friend?.trim();
    if (!id) return '';
    const member = availableMembers.find(m => m.id === id);
    if (!member) return friend;
    const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
    return fullName || friend;
  };
  const friendDisplayNames = friendNames.map(getFriendDisplayName).filter(Boolean);

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[85vh] sm:h-full sm:w-full sm:max-w-lg sm:side-right"
      >
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-3">
            {(() => {
              const photo =
                getMemberPhotoURL(convert.memberData) ||
                getMemberPhotoURL(convert);
              if (photo) {
                return (
                  <Image
                    src={photo}
                    alt={convert.name}
                    width={48}
                    height={48}
                    className="h-12 w-12 rounded-full object-cover shrink-0"
                    unoptimized
                  />
                );
              }
              return (
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Users className="h-5 w-5 text-muted-foreground" />
                </div>
              );
            })()}
            <div className="text-left">
              <SheetTitle className="text-lg">{convert.name}</SheetTitle>
              <SheetDescription>
                {t('converts.sheet.baptizedOn', {
                  date: format(convert.baptismDate.toDate(), 'd MMMM yyyy', { locale: getDateFnsLocale() }),
                })}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(85vh-140px)] sm:h-[calc(100vh-200px)] pr-4">
          <div className="space-y-6 py-4">
            {/* Friend Assignment Status */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${hasFriendship ? 'bg-green-500' : 'bg-amber-500'}`} />
                  {t('converts.sheet.quorumFriendAssigned')}
                </h3>
                {onSaveFriends && canWrite && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setEditingFriends(!editingFriends)}
                    className="h-7 px-2"
                  >
                    {editingFriends ? t('common.cancel') : (hasFriendship ? t('common.edit') : t('common.add'))}
                  </Button>
                )}
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                {editingFriends ? (
                  <div className="space-y-2">
                    {friendInputs.map((friend, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <div className="flex-1">
                          <MemberSelector
                            value={friend}
                            onValueChange={(value) => handleFriendInputChange(idx, value || '')}
                            placeholder={t('converts.sheet.selectFriendN', { n: idx + 1 })}
                            statusFilter={["active"]}
                            allowClear={false}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => handleRemoveFriendInput(idx)}
                          disabled={friendInputs.length <= 1}
                          className="h-9 w-9"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddFriendInput}
                      className="w-full"
                    >
                      <PlusCircle className="mr-2 h-4 w-4" />
                      {t('converts.sheet.addFriend')}
                    </Button>
                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingFriends(false)}
                        className="flex-1"
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveFriends}
                        disabled={saving}
                        className="flex-1"
                      >
                        {saving ? t('common.saving') : t('converts.sheet.saveFriends')}
                      </Button>
                    </div>
                  </div>
                ) : hasFriendship ? (
                  <div className="flex flex-wrap gap-2">
                    {friendDisplayNames.map((friend: string, idx: number) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        <UserPlus className="h-3 w-3 mr-1" />
                        {friend}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('converts.sheet.noFriends')}
                  </p>
                )}
              </div>
            </section>

            <Separator />

            {/* Ordinances */}
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                {t('converts.sheet.ordinancesReceived')}
              </h3>
              <div className="bg-muted/50 rounded-lg p-3">
                {ordinances.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {ordinances.map((ordinance) => (
                      <Badge key={ordinance} variant="outline" className="text-xs">
                        {t(`ordinance.${ordinance as Ordinance}`)}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('converts.sheet.noOrdinances')}
                  </p>
                )}
              </div>
            </section>

            <Separator />

            {/* Calling Input */}
            <section>
              <Label htmlFor="calling" className="text-sm font-semibold text-muted-foreground mb-2 block">
                {t('converts.sheet.calling')}
              </Label>
              <Input
                id="calling"
                placeholder={t('converts.sheet.callingPlaceholder')}
                value={calling}
                onChange={(e) => handleCallingChange(e.target.value)}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('converts.sheet.callingHelp')}
              </p>
            </section>

            <Separator />

            <section>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold text-muted-foreground">{t('converts.sheet.recommendation')}</Label>
                    <p className="text-xs text-muted-foreground">{t('converts.sheet.recommendationHelp')}</p>
                  </div>
                  <Switch
                    checked={recommendationActive}
                    onCheckedChange={handleRecommendationChange}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold text-muted-foreground">{t('converts.sheet.selfRelianceCourse')}</Label>
                    <p className="text-xs text-muted-foreground">{t('converts.sheet.selfRelianceCourseHelp')}</p>
                  </div>
                  <Switch
                    checked={selfRelianceCourse}
                    onCheckedChange={handleSelfRelianceCourseChange}
                  />
                </div>
              </div>
            </section>

            <Separator />

            {/* Ministering Teachers */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  {t('converts.sheet.ministeringTeachers')}
                </h3>
                {onSaveTeachers && convert?.memberData?.id && canWrite && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setEditingTeachers(!editingTeachers)}
                    className="h-7 px-2"
                  >
                    {editingTeachers ? t('common.cancel') : (teachers.length > 0 ? t('common.edit') : t('common.add'))}
                  </Button>
                )}
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                {editingTeachers ? (
                  <div className="space-y-2">
                    {teacherInputs.map((teacher, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <div className="flex-1">
                          <MemberSelector
                            value={teacher}
                            onValueChange={(value) => handleTeacherInputChange(idx, value || '')}
                            placeholder={t('converts.sheet.selectTeacherN', { n: idx + 1 })}
                            statusFilter={["active"]}
                            allowClear={false}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => handleRemoveTeacherInput(idx)}
                          disabled={teacherInputs.length <= 1}
                          className="h-9 w-9"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddTeacherInput}
                      className="w-full"
                    >
                      <PlusCircle className="mr-2 h-4 w-4" />
                      {t('converts.sheet.addTeacher')}
                    </Button>
                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingTeachers(false)}
                        className="flex-1"
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveTeachers}
                        disabled={saving}
                        className="flex-1"
                      >
                        {saving ? t('common.saving') : t('converts.sheet.saveTeachers')}
                      </Button>
                    </div>
                  </div>
                ) : teachers.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {teachers.map((teacher: string, idx: number) => (
                      <Badge key={idx} variant="secondary" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                        {teacher}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {convert?.memberData?.id 
                      ? t('converts.sheet.noTeachersWithMember')
                      : t('converts.sheet.noTeachersWithoutMember')}
                  </p>
                )}
              </div>
            </section>

            <Separator />

            {/* Notes Textarea */}
            <section>
              <Label htmlFor="notes" className="text-sm font-semibold text-muted-foreground mb-2 block">
                {t('converts.sheet.notes')}
              </Label>
              <Textarea
                id="notes"
                placeholder={t('converts.sheet.notesPlaceholder')}
                value={notes}
                onChange={(e) => handleNotesChange(e.target.value)}
                rows={4}
                className="text-sm resize-none"
              />
            </section>
          </div>
        </ScrollArea>

        <div className="absolute bottom-0 left-0 right-0 p-4 bg-background border-t">
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              {t('common.close')}
            </Button>
            {canWrite && (
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={!hasChanges || saving}
            >
              {saving ? t('common.saving') : t('converts.sheet.saveChanges')}
            </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
