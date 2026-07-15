import {
  buildCatalogCallingsAnswer,
  formatCallingsContextBlock,
  getLeadershipLabels,
  isFullCallingsListRequest,
  normalizeOrgKey,
  resolveOrganizationCallings,
} from '@/lib/church-organization-callings';

describe('normalizeOrgKey', () => {
  it('strips accents and lowercases', () => {
    expect(normalizeOrgKey('Quórum de Élderes')).toBe('quorum de elderes');
  });
});

describe('resolveOrganizationCallings', () => {
  it('matches Quórum de Élderes variants', () => {
    const a = resolveOrganizationCallings('Quórum de Élderes', 'es');
    const b = resolveOrganizationCallings('Quorum de Elderes', 'es');
    const c = resolveOrganizationCallings('Elders Quorum', 'en');

    expect(a?.catalog.nameEs).toBe('Quórum de Élderes');
    expect(b?.catalog.nameEs).toBe('Quórum de Élderes');
    expect(c?.catalog.nameEn).toBe('Elders Quorum');
    expect((a?.callings.length ?? 0) > 5).toBe(true);
  });

  it('matches Sociedad de Socorro and uses feminine leadership', () => {
    const rs = resolveOrganizationCallings('Sociedad de Socorro', 'es');
    expect(rs?.catalog.nameEs).toBe('Sociedad de Socorro');
    expect(rs?.catalog.feminineLeadershipEs).toBe(true);
    expect(rs?.callings.some((c) => c.title.includes('Presidenta'))).toBe(true);
  });

  it('matches Primaria and Mujeres Jóvenes', () => {
    expect(resolveOrganizationCallings('Primaria', 'es')?.catalog.nameEs).toBe('Primaria');
    expect(resolveOrganizationCallings('Mujeres Jóvenes', 'es')?.catalog.nameEs).toBe(
      'Mujeres Jóvenes',
    );
  });

  it('returns null for empty or unknown org', () => {
    expect(resolveOrganizationCallings('', 'es')).toBe(null);
    expect(resolveOrganizationCallings('Organización inventada XYZ', 'es')).toBe(null);
  });

  it('returns English callings when language is en', () => {
    const eq = resolveOrganizationCallings('Quórum de Élderes', 'en');
    expect(eq?.displayName).toBe('Elders Quorum');
    expect(eq?.callings[0]?.title.includes('Elders Quorum President')).toBe(true);
  });
});

describe('formatCallingsContextBlock', () => {
  it('lists every calling and instructs full enumeration', () => {
    const resolved = resolveOrganizationCallings('Sociedad de Socorro', 'es');
    expect(resolved === null).toBe(false);
    if (!resolved) return;
    const block = formatCallingsContextBlock(resolved, 'es');
    expect(block.includes('LLAMAMIENTOS_Y_ASIGNACIONES')).toBe(true);
    expect(block.includes('TODOS')).toBe(true);
    for (const calling of resolved.callings) {
      expect(block.includes(calling.title)).toBe(true);
    }
  });
});

describe('getLeadershipLabels', () => {
  it('uses masculine titles for Elders Quorum in Spanish', () => {
    expect(getLeadershipLabels('Quórum de Élderes', 'es')).toEqual({
      president: 'Presidente',
      counselor: 'Consejero',
      secretary: 'Secretario',
    });
  });

  it('uses feminine titles for Relief Society in Spanish', () => {
    expect(getLeadershipLabels('Sociedad de Socorro', 'es')).toEqual({
      president: 'Presidenta',
      counselor: 'Consejera',
      secretary: 'Secretaria',
    });
  });

  it('uses English titles when language is en', () => {
    expect(getLeadershipLabels('Sociedad de Socorro', 'en').president).toBe('President');
  });
});

describe('isFullCallingsListRequest', () => {
  it('detects the otros cargos quick prompt', () => {
    expect(
      isFullCallingsListRequest(
        'Lista TODOS los llamamientos y asignaciones típicos del Quórum de Élderes según el Manual General.',
      ),
    ).toBe(true);
  });

  it('does not treat a single-role question as a full list request', () => {
    expect(
      isFullCallingsListRequest(
        'Explica el llamamiento de Presidente del Quórum de Élderes: ¿qué hace y por qué son importantes esas responsabilidades?',
      ),
    ).toBe(false);
  });
});

describe('buildCatalogCallingsAnswer', () => {
  it('includes every calling title for the organization', () => {
    const resolved = resolveOrganizationCallings('Sociedad de Socorro', 'es');
    expect(resolved === null).toBe(false);
    if (!resolved) return;
    const answer = buildCatalogCallingsAnswer(resolved, 'es');
    expect(answer.includes('Sociedad de Socorro')).toBe(true);
    for (const calling of resolved.callings) {
      expect(answer.includes(calling.title)).toBe(true);
    }
  });
});
