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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { OfflineImage } from '@/components/offline-image';
import { CalendarIcon, PlusCircle, Trash2, UserPlus, Users, X } from 'lucide-react';
import type { Timestamp } from 'firebase/firestore';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { safeGetDate } from '@/lib/date-utils';
import { MemberSelector } from '@/components/members/member-selector';
import type { Convert, Member, NewConvertFriendship, Ordinance, FamilySearchTreeStatus } from '@/lib/types';
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
  /** Fechas de la recomendación (viven en el miembro) */
  recommendationIssueDate?: Timestamp | null;
  recommendationExpirationDate?: Timestamp | null;
  selfRelianceCourse?: boolean;
  hasLdsAccount?: boolean;
  hasFamilySearchAccount?: boolean;
  familySearchGenerations?: number | null;
  familySearchTreeStatus?: FamilySearchTreeStatus | null;
  familySearchPartialDetails?: string | null;
  memberId?: string;
};

export type ConvertInfoSavePayload = {
  calling: string;
  notes: string;
  recommendationActive: boolean;
  /** Opcionales: se puede guardar la recomendación sin fechas */
  recommendationIssueDate?: Date | null;
  recommendationExpirationDate?: Date | null;
  selfRelianceCourse: boolean;
  hasLdsAccount: boolean;
  hasFamilySearchAccount: boolean;
  familySearchGenerations?: number | null;
  familySearchTreeStatus?: FamilySearchTreeStatus | null;
  familySearchPartialDetails?: string | null;
};

// Convert Info Sheet Component
interface ConvertInfoSheetProps {
  convert: ConvertWithInfo | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (convertId: string, data: ConvertInfoSavePayload) => Promise<void>;
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
  const [recommendationIssueDate, setRecommendationIssueDate] = useState<Date | undefined>(
    safeGetDate(convert?.recommendationIssueDate) ?? undefined
  );
  const [recommendationExpirationDate, setRecommendationExpirationDate] = useState<Date | undefined>(
    safeGetDate(convert?.recommendationExpirationDate) ?? undefined
  );
  const [selfRelianceCourse, setSelfRelianceCourse] = useState(!!convert?.selfRelianceCourse);
  const [hasLdsAccount, setHasLdsAccount] = useState(
    !!(convert?.hasLdsAccount ?? convert?.memberData?.hasLdsAccount)
  );
  const [hasFamilySearchAccount, setHasFamilySearchAccount] = useState(
    !!(convert?.hasFamilySearchAccount ?? convert?.memberData?.hasFamilySearchAccount)
  );
  const [familySearchGenerations, setFamilySearchGenerations] = useState(
    convert?.familySearchGenerations != null && convert.familySearchGenerations > 0
      ? String(convert.familySearchGenerations)
      : convert?.memberData?.familySearchGenerations != null && convert.memberData.familySearchGenerations > 0
        ? String(convert.memberData.familySearchGenerations)
        : ''
  );
  const [familySearchTreeStatus, setFamilySearchTreeStatus] = useState<FamilySearchTreeStatus | null>(
    convert?.familySearchTreeStatus ?? convert?.memberData?.familySearchTreeStatus ?? null
  );
  const [familySearchPartialDetails, setFamilySearchPartialDetails] = useState(
    convert?.familySearchPartialDetails || convert?.memberData?.familySearchPartialDetails || ''
  );
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
        setRecommendationIssueDate(safeGetDate(convert?.recommendationIssueDate) ?? undefined);
        setRecommendationExpirationDate(
          safeGetDate(convert?.recommendationExpirationDate) ?? undefined
        );
        setSelfRelianceCourse(!!convert?.selfRelianceCourse);
        setHasLdsAccount(!!(convert?.hasLdsAccount ?? convert?.memberData?.hasLdsAccount));
        setHasFamilySearchAccount(
          !!(convert?.hasFamilySearchAccount ?? convert?.memberData?.hasFamilySearchAccount)
        );
        const gens =
          convert?.familySearchGenerations ?? convert?.memberData?.familySearchGenerations;
        setFamilySearchGenerations(
          gens != null && gens > 0 ? String(gens) : ''
        );
        setFamilySearchTreeStatus(
          convert?.familySearchTreeStatus ?? convert?.memberData?.familySearchTreeStatus ?? null
        );
        setFamilySearchPartialDetails(
          convert?.familySearchPartialDetails || convert?.memberData?.familySearchPartialDetails || ''
        );
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
  }, [
    currentConvertId,
    convert?.calling,
    convert?.notes,
    convert?.recommendationActive,
    convert?.recommendationIssueDate,
    convert?.recommendationExpirationDate,
    convert?.selfRelianceCourse,
    convert?.hasLdsAccount,
    convert?.hasFamilySearchAccount,
    convert?.familySearchGenerations,
    convert?.familySearchTreeStatus,
    convert?.familySearchPartialDetails,
    convert?.memberData?.hasLdsAccount,
    convert?.memberData?.hasFamilySearchAccount,
    convert?.memberData?.familySearchGenerations,
    convert?.memberData?.familySearchTreeStatus,
    convert?.memberData?.familySearchPartialDetails,
    convert?.friendship?.friends,
    convert?.ministeringTeachers,
  ]);

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
    if (!value) {
      setRecommendationIssueDate(undefined);
      setRecommendationExpirationDate(undefined);
    }
    setHasChanges(true);
  };

  const handleSelfRelianceCourseChange = (value: boolean) => {
    setSelfRelianceCourse(value);
    setHasChanges(true);
  };

  const handleLdsAccountChange = (value: boolean) => {
    setHasLdsAccount(value);
    setHasChanges(true);
  };

  const handleFamilySearchAccountChange = (value: boolean) => {
    setHasFamilySearchAccount(value);
    if (!value) {
      setFamilySearchGenerations('');
      setFamilySearchTreeStatus(null);
      setFamilySearchPartialDetails('');
    }
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
    let generations: number | null = null;
    if (hasFamilySearchAccount) {
      const genRaw = familySearchGenerations.trim();
      if (genRaw) {
        const n = parseInt(genRaw, 10);
        if (!Number.isNaN(n) && n > 0) generations = n;
      }
    }
    const treeStatus = hasFamilySearchAccount ? familySearchTreeStatus : null;
    const partialDetails =
      hasFamilySearchAccount && treeStatus === 'partial'
        ? familySearchPartialDetails.trim() || null
        : null;

    await onSave(convert.id, {
      calling,
      notes,
      recommendationActive,
      recommendationIssueDate: recommendationActive ? recommendationIssueDate ?? null : null,
      recommendationExpirationDate:
        recommendationActive ? recommendationExpirationDate ?? null : null,
      selfRelianceCourse,
      hasLdsAccount,
      hasFamilySearchAccount,
      familySearchGenerations: hasFamilySearchAccount ? generations : null,
      familySearchTreeStatus: treeStatus,
      familySearchPartialDetails: partialDetails,
    });
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
                  <OfflineImage
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
            <div className="text-left min-w-0">
              <SheetTitle className="text-lg">{convert.name}</SheetTitle>
              <SheetDescription>
                {t('converts.sheet.baptizedOn', {
                  date: format(convert.baptismDate.toDate(), 'd MMMM yyyy', { locale: getDateFnsLocale() }),
                })}
              </SheetDescription>
              <div className="mt-2 flex flex-wrap gap-1">
                {convert.calling?.trim() ? (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-normal">
                    {t('converts.badge.calling', { calling: convert.calling.trim() })}
                  </Badge>
                ) : null}
                <Badge
                  variant={convert.recommendationActive ? 'default' : 'outline'}
                  className="text-[10px] px-1.5 py-0 h-5 font-normal"
                >
                  {convert.recommendationActive
                    ? t('converts.badge.recommendationYes')
                    : t('converts.badge.recommendationNo')}
                </Badge>
                <Badge
                  variant={convert.selfRelianceCourse ? 'default' : 'outline'}
                  className="text-[10px] px-1.5 py-0 h-5 font-normal"
                >
                  {convert.selfRelianceCourse
                    ? t('converts.badge.selfRelianceYes')
                    : t('converts.badge.selfRelianceNo')}
                </Badge>
                <Badge
                  variant={
                    (convert.hasLdsAccount ?? convert.memberData?.hasLdsAccount)
                      ? 'default'
                      : 'outline'
                  }
                  className="text-[10px] px-1.5 py-0 h-5 font-normal"
                >
                  {(convert.hasLdsAccount ?? convert.memberData?.hasLdsAccount)
                    ? t('converts.badge.ldsYes')
                    : t('converts.badge.ldsNo')}
                </Badge>
                <Badge
                  variant={
                    (convert.hasFamilySearchAccount ?? convert.memberData?.hasFamilySearchAccount)
                      ? 'default'
                      : 'outline'
                  }
                  className="text-[10px] px-1.5 py-0 h-5 font-normal"
                >
                  {(convert.hasFamilySearchAccount ?? convert.memberData?.hasFamilySearchAccount)
                    ? t('converts.badge.familySearchYes')
                    : t('converts.badge.familySearchNo')}
                </Badge>
                <Badge
                  variant={hasFriendship ? 'secondary' : 'outline'}
                  className="text-[10px] px-1.5 py-0 h-5 font-normal"
                >
                  {hasFriendship
                    ? t('converts.badge.friendsYes')
                    : t('converts.badge.friendsNo')}
                </Badge>
              </div>
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
                    aria-label={t('converts.sheet.recommendation')}
                  />
                </div>

                {recommendationActive && (
                  <div className="space-y-3 rounded-lg border border-dashed bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">
                      {t('converts.sheet.recommendationDatesHelp')}
                    </p>

                    <div className="space-y-1.5">
                      <Label className="text-sm">
                        {t('converts.sheet.recommendationIssueDate')}
                      </Label>
                      <div className="flex gap-2">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              className={cn(
                                'flex-1 justify-start pl-3 text-left font-normal',
                                !recommendationIssueDate && 'text-muted-foreground'
                              )}
                            >
                              {recommendationIssueDate ? (
                                <span className="capitalize">
                                  {format(recommendationIssueDate, "d 'de' LLLL 'de' yyyy", {
                                    locale: getDateFnsLocale(),
                                  })}
                                </span>
                              ) : (
                                <span>{t('common.selectDate')}</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={recommendationIssueDate}
                              onSelect={(date) => {
                                setRecommendationIssueDate(date);
                                setHasChanges(true);
                              }}
                              defaultMonth={recommendationIssueDate}
                              disabled={(date) => date < new Date('1900-01-01')}
                              locale={getDateFnsLocale()}
                            />
                          </PopoverContent>
                        </Popover>
                        {recommendationIssueDate && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              setRecommendationIssueDate(undefined);
                              setHasChanges(true);
                            }}
                            title={t('converts.sheet.clearDate')}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-sm">
                        {t('converts.sheet.recommendationExpirationDate')}
                      </Label>
                      <div className="flex gap-2">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              className={cn(
                                'flex-1 justify-start pl-3 text-left font-normal',
                                !recommendationExpirationDate && 'text-muted-foreground'
                              )}
                            >
                              {recommendationExpirationDate ? (
                                <span className="capitalize">
                                  {format(recommendationExpirationDate, "d 'de' LLLL 'de' yyyy", {
                                    locale: getDateFnsLocale(),
                                  })}
                                </span>
                              ) : (
                                <span>{t('common.selectDate')}</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={recommendationExpirationDate}
                              onSelect={(date) => {
                                setRecommendationExpirationDate(date);
                                setHasChanges(true);
                              }}
                              defaultMonth={recommendationExpirationDate}
                              disabled={(date) => date < new Date('1900-01-01')}
                              locale={getDateFnsLocale()}
                            />
                          </PopoverContent>
                        </Popover>
                        {recommendationExpirationDate && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              setRecommendationExpirationDate(undefined);
                              setHasChanges(true);
                            }}
                            title={t('converts.sheet.clearDate')}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

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
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold text-muted-foreground">{t('converts.sheet.hasLdsAccount')}</Label>
                    <p className="text-xs text-muted-foreground">{t('converts.sheet.hasLdsAccountHelp')}</p>
                  </div>
                  <Switch
                    checked={hasLdsAccount}
                    onCheckedChange={handleLdsAccountChange}
                  />
                </div>
                <div className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <Label className="text-sm font-semibold text-muted-foreground">{t('converts.sheet.hasFamilySearchAccount')}</Label>
                      <p className="text-xs text-muted-foreground">{t('converts.sheet.hasFamilySearchAccountHelp')}</p>
                    </div>
                    <Switch
                      checked={hasFamilySearchAccount}
                      onCheckedChange={handleFamilySearchAccountChange}
                    />
                  </div>

                  {hasFamilySearchAccount && (
                    <div className="space-y-3 border-t pt-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="fs-generations" className="text-sm">
                          {t('converts.sheet.familySearchGenerations')}
                        </Label>
                        <Input
                          id="fs-generations"
                          type="number"
                          min={1}
                          max={50}
                          inputMode="numeric"
                          placeholder={t('converts.sheet.familySearchGenerationsPlaceholder')}
                          value={familySearchGenerations}
                          onChange={(e) => {
                            setFamilySearchGenerations(e.target.value);
                            setHasChanges(true);
                          }}
                          className="text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('converts.sheet.familySearchGenerationsHelp')}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm">{t('converts.sheet.familySearchTreeStatus')}</Label>
                        <RadioGroup
                          value={familySearchTreeStatus || ''}
                          onValueChange={(value) => {
                            if (value === 'complete' || value === 'partial') {
                              setFamilySearchTreeStatus(value);
                              if (value === 'complete') setFamilySearchPartialDetails('');
                            } else {
                              setFamilySearchTreeStatus(null);
                            }
                            setHasChanges(true);
                          }}
                          className="flex flex-col gap-2 sm:flex-row sm:gap-4"
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="complete" id="convert-fs-complete" />
                            <Label htmlFor="convert-fs-complete" className="font-normal cursor-pointer text-sm">
                              {t('converts.sheet.familySearchTreeComplete')}
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="partial" id="convert-fs-partial" />
                            <Label htmlFor="convert-fs-partial" className="font-normal cursor-pointer text-sm">
                              {t('converts.sheet.familySearchTreePartial')}
                            </Label>
                          </div>
                        </RadioGroup>
                        <p className="text-xs text-muted-foreground">
                          {t('converts.sheet.familySearchTreeStatusHelp')}
                        </p>
                      </div>

                      {familySearchTreeStatus === 'partial' && (
                        <div className="space-y-1.5">
                          <Label htmlFor="fs-partial-details" className="text-sm">
                            {t('converts.sheet.familySearchPartialDetails')}
                          </Label>
                          <Textarea
                            id="fs-partial-details"
                            placeholder={t('converts.sheet.familySearchPartialDetailsPlaceholder')}
                            value={familySearchPartialDetails}
                            onChange={(e) => {
                              setFamilySearchPartialDetails(e.target.value);
                              setHasChanges(true);
                            }}
                            rows={3}
                            className="text-sm resize-none"
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('converts.sheet.familySearchPartialDetailsHelp')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
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
