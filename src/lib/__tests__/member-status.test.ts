import { normalizeMemberStatus } from '@/lib/members-data';
import { prepareMemberDataForAPI } from '@/lib/member-service';
import { Timestamp } from 'firebase/firestore';
import { buildMemberEditUrl, buildMemberLink } from '@/lib/navigation';
import { getAvailableCompanionMembers, getAvailableFamilyMembers, resolveSelectedDistrictId, validateNoDuplicateFamilies } from '@/lib/ministering-validations';
import type { Member } from '@/lib/types';

describe('normalizeMemberStatus', () => {
  it('maps fallecido variants to deceased', () => {
    expect(normalizeMemberStatus('fallecido')).toBe('deceased');
    expect(normalizeMemberStatus('fallecida')).toBe('deceased');
    expect(normalizeMemberStatus('deceased')).toBe('deceased');
  });

  it('maps spanish and english status variants correctly', () => {
    expect(normalizeMemberStatus('activo')).toBe('active');
    expect(normalizeMemberStatus('active')).toBe('active');
    expect(normalizeMemberStatus('menos activo')).toBe('less_active');
    expect(normalizeMemberStatus('less active')).toBe('less_active');
    expect(normalizeMemberStatus('inactivo')).toBe('inactive');
    expect(normalizeMemberStatus('inactive')).toBe('inactive');
  });

  it('defaults to active for unknown values', () => {
    expect(normalizeMemberStatus(undefined)).toBe('active');
    expect(normalizeMemberStatus(null)).toBe('active');
    expect(normalizeMemberStatus('')).toBe('active');
    expect(normalizeMemberStatus('otro')).toBe('active');
  });
});

describe('buildMemberEditUrl', () => {
  it('adds returnTo when valid', () => {
    expect(buildMemberEditUrl('123', '/converts')).toBe('/members?edit=123&returnTo=%2Fconverts');
  });

  it('omits returnTo when invalid', () => {
    expect(buildMemberEditUrl('123', 'http://example.com')).toBe('/members?edit=123');
  });
});

describe('buildMemberLink', () => {
  const baseMember = {
    status: 'active',
    createdAt: Timestamp.fromDate(new Date('2024-01-01T00:00:00.000Z')),
    updatedAt: Timestamp.fromDate(new Date('2024-01-01T00:00:00.000Z')),
    createdBy: 'test-user',
  } satisfies Pick<Member, 'status' | 'createdAt' | 'updatedAt' | 'createdBy'>;
  const members: Member[] = [
    { id: '1', firstName: 'Juan', lastName: 'Pilligua', ...baseMember },
    { id: '2', firstName: 'Jhonny', lastName: 'Pilligua', ...baseMember },
    { id: '3', firstName: 'Maria', lastName: 'Lopez', ...baseMember },
  ];
  const memberMap = new Map([
    ['Juan Pilligua', '1'],
    ['Jhonny Pilligua', '2'],
  ]);

  it('prefers memberId when provided', () => {
    const link = buildMemberLink({
      name: 'Familia Pilligua',
      memberId: '2',
      members,
      memberMap,
    });
    expect(link).toBe('/members/2');
  });

  it('resolves companion name using memberMap', () => {
    const link = buildMemberLink({
      name: 'Juan Pilligua',
      members,
      memberMap,
    });
    expect(link).toBe('/members/1');
  });

  it('falls back to search when no match', () => {
    const link = buildMemberLink({
      name: 'Familia Ramirez',
      members,
      memberMap,
    });
    expect(link).toBe('/members?search=Ramirez');
  });

  it('falls back to search when last name is ambiguous', () => {
    const link = buildMemberLink({
      name: 'Familia Pilligua',
      members,
      memberMap,
    });
    expect(link).toBe('/members?search=Pilligua');
  });
});

describe('validateNoDuplicateFamilies', () => {
  it('permits same family name when memberId differs', () => {
    const result = validateNoDuplicateFamilies([
      { name: 'Familia Pilligua', memberId: '1' },
      { name: 'Familia Pilligua', memberId: '2' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.duplicates.length).toBe(0);
  });

  it('flags duplicate when memberId matches', () => {
    const result = validateNoDuplicateFamilies([
      { name: 'Familia Lopez', memberId: '3' },
      { name: 'Familia Lopez', memberId: '3' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.duplicates).toEqual(['Familia Lopez']);
  });
});

describe('resolveSelectedDistrictId', () => {
  it('returns district id when companionship is assigned', () => {
    const result = resolveSelectedDistrictId({
      districts: [
        { id: 'd1', name: 'Distrito 1', companionshipIds: ['c1'] },
        { id: 'd2', name: 'Distrito 2', companionshipIds: [] },
      ],
      companionshipId: 'c1',
      fallbackId: 'none',
    });
    expect(result).toBe('d1');
  });

  it('falls back when companionship has no district', () => {
    const result = resolveSelectedDistrictId({
      districts: [{ id: 'd1', name: 'Distrito 1', companionshipIds: [] }],
      companionshipId: 'c2',
      fallbackId: 'none',
    });
    expect(result).toBe('none');
  });
});

describe('getAvailableCompanionMembers', () => {
  const baseMember = {
    status: 'active',
    createdAt: Timestamp.fromDate(new Date('2024-01-01T00:00:00.000Z')),
    updatedAt: Timestamp.fromDate(new Date('2024-01-01T00:00:00.000Z')),
    createdBy: 'test-user',
  } satisfies Pick<Member, 'status' | 'createdAt' | 'updatedAt' | 'createdBy'>;

  const members: Member[] = [
    { id: '1', firstName: 'Juan', lastName: 'Pilligua', ...baseMember },
    { id: '2', firstName: 'Jhonny', lastName: 'Pilligua', ...baseMember },
  ];

  it('excludes companions assigned to other companionships', () => {
    const result = getAvailableCompanionMembers({
      members,
      companionships: [
        { id: 'c1', companions: ['Juan Pilligua'], families: [] },
        { id: 'c2', companions: [], families: [] },
      ],
      currentCompanionshipId: 'c2',
    });
    expect(result.map(m => m.id)).toEqual(['2']);
  });

  it('keeps companions from current companionship', () => {
    const result = getAvailableCompanionMembers({
      members,
      companionships: [
        { id: 'c1', companions: ['Juan Pilligua'], families: [] },
      ],
      currentCompanionshipId: 'c1',
    });
    expect(result.map(m => m.id)).toEqual(['1', '2']);
  });
});

describe('getAvailableFamilyMembers', () => {
  const baseMember = {
    status: 'active',
    createdAt: Timestamp.fromDate(new Date('2024-01-01T00:00:00.000Z')),
    updatedAt: Timestamp.fromDate(new Date('2024-01-01T00:00:00.000Z')),
    createdBy: 'test-user',
  } satisfies Pick<Member, 'status' | 'createdAt' | 'updatedAt' | 'createdBy'>;

  const members: Member[] = [
    { id: '1', firstName: 'Juan', lastName: 'Pilligua', ...baseMember },
    { id: '2', firstName: 'Jhonny', lastName: 'Pilligua', ...baseMember },
    { id: '3', firstName: 'Maria', lastName: 'Lopez', ...baseMember },
  ];

  it('excludes families assigned by memberId in other companionships', () => {
    const result = getAvailableFamilyMembers({
      members,
      companionships: [
        { id: 'c1', companions: [], families: [{ name: 'Familia Pilligua', isUrgent: false, observation: '', memberId: '1' }] },
      ],
      currentCompanionshipId: 'c2',
    });
    expect(result.map(m => m.id)).toEqual(['2', '3']);
  });

  it('keeps families from current companionship', () => {
    const result = getAvailableFamilyMembers({
      members,
      companionships: [
        { id: 'c1', companions: [], families: [{ name: 'Familia Pilligua', isUrgent: false, observation: '', memberId: '1' }] },
      ],
      currentCompanionshipId: 'c1',
    });
    expect(result.map(m => m.id)).toEqual(['1', '2', '3']);
  });
});

describe('prepareMemberDataForAPI', () => {
  it('includes deathDate when provided', () => {
    const deathDate = new Date('2024-05-10T00:00:00.000Z');
    const result = prepareMemberDataForAPI(
      {
        firstName: 'Juan',
        lastName: 'Perez',
        status: 'deceased',
        deathDate,
      },
      null,
      []
    );

    expect(result.deathDate).toBe(deathDate.toISOString());
  });

  it('omits deathDate when not provided', () => {
    const result = prepareMemberDataForAPI(
      {
        firstName: 'Ana',
        lastName: 'Lopez',
        status: 'active',
      },
      null,
      []
    );

    expect(result.deathDate).toBe(undefined);
  });
});
