/**
 * Catalog of typical callings / assignments per Church organization.
 * Used by church-chat so the AI can answer "otros cargos" dynamically
 * for the signed-in user's organization (Handbook-aligned, not ward data).
 *
 * Names are matched loosely (accents, Quórum/Quorum, ES/EN labels).
 */

export type OrgCallingLanguage = 'es' | 'en';

export type OrgCalling = {
  /** Official-style title for the calling */
  title: string;
  /** Short "why it exists" for the AI to expand on */
  purpose: string;
};

export type OrganizationCallingsCatalog = {
  /** Canonical display name in Spanish */
  nameEs: string;
  /** Canonical display name in English */
  nameEn: string;
  /** Keywords used to match user.organizacion (lowercase, no accents) */
  matchKeys: string[];
  /** Leadership tends to use feminine titles in Spanish (RS, YW, often Primary) */
  feminineLeadershipEs: boolean;
  callings: {
    es: OrgCalling[];
    en: OrgCalling[];
  };
};

const stripDiacritics = (value: string): string =>
  value.normalize('NFD').replace(/\p{M}/gu, '');

/** Normalize for matching: lowercase, no accents, collapsed spaces. */
export const normalizeOrgKey = (value: string): string =>
  stripDiacritics(value)
    .toLowerCase()
    .replace(/[|/_,.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Official-style calling lists for organizations supported by the app
 * (seed + common ward auxiliaries). Not an exhaustive Handbook dump —
 * enough for leadership orientation in chat.
 */
export const ORGANIZATION_CALLINGS: readonly OrganizationCallingsCatalog[] = [
  {
    nameEs: 'Quórum de Élderes',
    nameEn: 'Elders Quorum',
    matchKeys: [
      'quorum de elderes',
      'quorum de los elderes',
      'elders quorum',
      'elderes',
      'elders',
    ],
    feminineLeadershipEs: false,
    callings: {
      es: [
        {
          title: 'Presidente del Quórum de Élderes',
          purpose:
            'Preside el quórum bajo la dirección del obispo; cuida espiritual y temporalmente a los hermanos y sus familias.',
        },
        {
          title: 'Primer consejero',
          purpose:
            'Apoya al presidente; suele coordinar áreas como ministración, reactivación o servicio según se asigne.',
        },
        {
          title: 'Segundo consejero',
          purpose:
            'Apoya al presidente; suele coordinar otras áreas (obra misional, templo e historia familiar, actividades, etc.).',
        },
        {
          title: 'Secretario del quórum',
          purpose:
            'Lleva registros, actas, informes y ayuda a la presidencia a organizar el trabajo del quórum.',
        },
        {
          title: 'Secretario(s) asistente(s)',
          purpose:
            'Apoya al secretario en registros, asistencia, ministración u otras tareas administrativas del quórum.',
        },
        {
          title: 'Instructores / maestros del quórum',
          purpose:
            'Enseñan lecciones y discusiones del evangelio en las reuniones del quórum.',
        },
        {
          title: 'Líder o especialista de ministración',
          purpose:
            'Ayuda a la presidencia a organizar y dar seguimiento a la ministración de los hermanos.',
        },
        {
          title: 'Líder o especialista de obra misional',
          purpose:
            'Coordina esfuerzos misionales del quórum con la presidencia y los misioneros de tiempo completo.',
        },
        {
          title: 'Líder o especialista de templo e historia familiar',
          purpose:
            'Fomenta la obra del templo y la historia familiar entre los hermanos del quórum.',
        },
        {
          title: 'Coordinador de servicio / actividades',
          purpose:
            'Organiza proyectos de servicio y actividades del quórum bajo la dirección de la presidencia.',
        },
        {
          title: 'Asignaciones de ministración (hermanos ministrantes)',
          purpose:
            'Cada hermano apto recibe asignaciones de ministración para cuidar a personas y familias asignadas.',
        },
      ],
      en: [
        {
          title: 'Elders Quorum President',
          purpose:
            'Presides over the quorum under the bishop; cares for brothers and their families spiritually and temporally.',
        },
        {
          title: 'First Counselor',
          purpose:
            'Supports the president; often coordinates areas such as ministering, reactivation, or service as assigned.',
        },
        {
          title: 'Second Counselor',
          purpose:
            'Supports the president; often coordinates other areas (missionary work, temple and family history, activities, etc.).',
        },
        {
          title: 'Quorum Secretary',
          purpose:
            'Keeps records, minutes, and reports, and helps the presidency organize the quorum’s work.',
        },
        {
          title: 'Assistant Secretary(ies)',
          purpose:
            'Supports the secretary with records, attendance, ministering, or other administrative tasks.',
        },
        {
          title: 'Quorum Teachers / Instructors',
          purpose:
            'Teach gospel lessons and discussions in quorum meetings.',
        },
        {
          title: 'Ministering Leader or Specialist',
          purpose:
            'Helps the presidency organize and follow up on ministering among the brothers.',
        },
        {
          title: 'Missionary Work Leader or Specialist',
          purpose:
            'Coordinates the quorum’s missionary efforts with the presidency and full-time missionaries.',
        },
        {
          title: 'Temple and Family History Leader or Specialist',
          purpose:
            'Encourages temple and family history work among quorum members.',
        },
        {
          title: 'Service / Activities Coordinator',
          purpose:
            'Organizes service projects and quorum activities under the presidency’s direction.',
        },
        {
          title: 'Ministering Assignments (ministering brothers)',
          purpose:
            'Each able brother receives ministering assignments to care for assigned individuals and families.',
        },
      ],
    },
  },
  {
    nameEs: 'Sociedad de Socorro',
    nameEn: 'Relief Society',
    matchKeys: [
      'sociedad de socorro',
      'relief society',
      'socorro',
    ],
    feminineLeadershipEs: true,
    callings: {
      es: [
        {
          title: 'Presidenta de la Sociedad de Socorro',
          purpose:
            'Preside la Sociedad de Socorro bajo la dirección del obispo; cuida a las hermanas espiritual y temporalmente.',
        },
        {
          title: 'Primera consejera',
          purpose:
            'Apoya a la presidenta; suele coordinar áreas como ministración, enseñanza o servicio según se asigne.',
        },
        {
          title: 'Segunda consejera',
          purpose:
            'Apoya a la presidenta; suele coordinar otras áreas (obra misional, templo e historia familiar, actividades, etc.).',
        },
        {
          title: 'Secretaria de la Sociedad de Socorro',
          purpose:
            'Lleva registros, actas, informes y organiza el trabajo administrativo de la presidencia.',
        },
        {
          title: 'Secretaria(s) asistente(s)',
          purpose:
            'Apoya a la secretaria en asistencia, registros, ministración u otras tareas.',
        },
        {
          title: 'Instructoras / maestras de la Sociedad de Socorro',
          purpose:
            'Enseñan lecciones y discusiones del evangelio en las reuniones de la Sociedad de Socorro.',
        },
        {
          title: 'Coordinadora de servicio compasivo',
          purpose:
            'Ayuda a organizar el servicio a hermanas y familias con necesidades temporales o de salud.',
        },
        {
          title: 'Líder o especialista de ministración',
          purpose:
            'Ayuda a la presidencia a organizar y dar seguimiento a la ministración de las hermanas.',
        },
        {
          title: 'Líder o especialista de obra misional',
          purpose:
            'Coordina esfuerzos misionales de las hermanas con la presidencia y los misioneros.',
        },
        {
          title: 'Líder o especialista de templo e historia familiar',
          purpose:
            'Fomenta la obra del templo y la historia familiar entre las hermanas.',
        },
        {
          title: 'Coordinadora de actividades',
          purpose:
            'Organiza actividades de hermandad y fortalecimiento bajo la dirección de la presidencia.',
        },
        {
          title: 'Asignaciones de ministración (hermanas ministrantes)',
          purpose:
            'Cada hermana apta recibe asignaciones de ministración para cuidar a personas y familias asignadas.',
        },
      ],
      en: [
        {
          title: 'Relief Society President',
          purpose:
            'Presides over Relief Society under the bishop; cares for sisters spiritually and temporally.',
        },
        {
          title: 'First Counselor',
          purpose:
            'Supports the president; often coordinates areas such as ministering, teaching, or service as assigned.',
        },
        {
          title: 'Second Counselor',
          purpose:
            'Supports the president; often coordinates other areas (missionary work, temple and family history, activities, etc.).',
        },
        {
          title: 'Relief Society Secretary',
          purpose:
            'Keeps records, minutes, and reports, and organizes the presidency’s administrative work.',
        },
        {
          title: 'Assistant Secretary(ies)',
          purpose:
            'Supports the secretary with attendance, records, ministering, or other tasks.',
        },
        {
          title: 'Relief Society Teachers / Instructors',
          purpose:
            'Teach gospel lessons and discussions in Relief Society meetings.',
        },
        {
          title: 'Compassionate Service Coordinator',
          purpose:
            'Helps organize service for sisters and families with temporal or health needs.',
        },
        {
          title: 'Ministering Leader or Specialist',
          purpose:
            'Helps the presidency organize and follow up on ministering among the sisters.',
        },
        {
          title: 'Missionary Work Leader or Specialist',
          purpose:
            'Coordinates sisters’ missionary efforts with the presidency and missionaries.',
        },
        {
          title: 'Temple and Family History Leader or Specialist',
          purpose:
            'Encourages temple and family history work among the sisters.',
        },
        {
          title: 'Activities Coordinator',
          purpose:
            'Organizes sisterhood and strengthening activities under the presidency’s direction.',
        },
        {
          title: 'Ministering Assignments (ministering sisters)',
          purpose:
            'Each able sister receives ministering assignments to care for assigned individuals and families.',
        },
      ],
    },
  },
  {
    nameEs: 'Primaria',
    nameEn: 'Primary',
    matchKeys: ['primaria', 'primary'],
    feminineLeadershipEs: true,
    callings: {
      es: [
        {
          title: 'Presidenta de la Primaria',
          purpose:
            'Preside la Primaria bajo la dirección del obispo; cuida el aprendizaje y el bienestar de los niños.',
        },
        {
          title: 'Primera consejera',
          purpose:
            'Apoya a la presidenta; a menudo supervisa clases o un grupo de edad según se asigne.',
        },
        {
          title: 'Segunda consejera',
          purpose:
            'Apoya a la presidenta; a menudo supervisa música, actividades u otro grupo de edad.',
        },
        {
          title: 'Secretaria de la Primaria',
          purpose:
            'Lleva asistencia, registros y ayuda a organizar la reunión y los llamamientos de la Primaria.',
        },
        {
          title: 'Líder de música de la Primaria',
          purpose:
            'Dirige el canto y la música en la Primaria para enseñar el evangelio a los niños.',
        },
        {
          title: 'Pianista / acompañante de la Primaria',
          purpose:
            'Acompaña musicalmente las reuniones y presentaciones de la Primaria.',
        },
        {
          title: 'Maestros / maestras de clase',
          purpose:
            'Enseñan el evangelio a un grupo de niños en su clase semanal.',
        },
        {
          title: 'Líderes de la guardería (Nursery)',
          purpose:
            'Cuidan y enseñan a los niños pequeños en un ambiente seguro y lleno de amor.',
        },
        {
          title: 'Líderes de actividades de la Primaria',
          purpose:
            'Ayudan con actividades y eventos de la Primaria bajo la dirección de la presidencia.',
        },
        {
          title: 'Especialistas adicionales (según se necesiten)',
          purpose:
            'Apoyan necesidades específicas (por ejemplo, niños con necesidades especiales o eventos) con aprobación del obispado.',
        },
      ],
      en: [
        {
          title: 'Primary President',
          purpose:
            'Presides over Primary under the bishop; oversees children’s learning and well-being.',
        },
        {
          title: 'First Counselor',
          purpose:
            'Supports the president; often oversees classes or an age group as assigned.',
        },
        {
          title: 'Second Counselor',
          purpose:
            'Supports the president; often oversees music, activities, or another age group.',
        },
        {
          title: 'Primary Secretary',
          purpose:
            'Keeps attendance and records and helps organize Primary meetings and callings.',
        },
        {
          title: 'Primary Music Leader',
          purpose:
            'Leads singing and music in Primary to teach the gospel to children.',
        },
        {
          title: 'Primary Pianist / Accompanist',
          purpose:
            'Provides musical accompaniment for Primary meetings and presentations.',
        },
        {
          title: 'Class Teachers',
          purpose:
            'Teach the gospel to a group of children in their weekly class.',
        },
        {
          title: 'Nursery Leaders',
          purpose:
            'Care for and teach young children in a safe, loving environment.',
        },
        {
          title: 'Primary Activity Leaders',
          purpose:
            'Help with Primary activities and events under the presidency’s direction.',
        },
        {
          title: 'Additional Specialists (as needed)',
          purpose:
            'Support specific needs (e.g. children with special needs or events) with bishopric approval.',
        },
      ],
    },
  },
  {
    nameEs: 'Mujeres Jóvenes',
    nameEn: 'Young Women',
    matchKeys: [
      'mujeres jovenes',
      'young women',
      'jovenes mujeres',
      'mj',
    ],
    feminineLeadershipEs: true,
    callings: {
      es: [
        {
          title: 'Presidenta de las Mujeres Jóvenes',
          purpose:
            'Preside las Mujeres Jóvenes bajo la dirección del obispo; guía el crecimiento espiritual de las jovencitas.',
        },
        {
          title: 'Primera consejera',
          purpose:
            'Apoya a la presidenta; suele enfocarse en clases o aspectos del programa según se asigne.',
        },
        {
          title: 'Segunda consejera',
          purpose:
            'Apoya a la presidenta; suele enfocar otras áreas del programa o de las clases.',
        },
        {
          title: 'Secretaria de las Mujeres Jóvenes',
          purpose:
            'Lleva registros, asistencia e informes del programa de las Mujeres Jóvenes.',
        },
        {
          title: 'Consejeras / asesoras de clase',
          purpose:
            'Apoyan a la presidencia y a las jovencitas de una clase o grupo de edad.',
        },
        {
          title: 'Presidencia de clase (presidentas de clase y consejeras)',
          purpose:
            'Las jovencitas lideran su clase, planifican y fortalecen a sus compañeras bajo la dirección de la presidencia.',
        },
        {
          title: 'Especialistas (música, actividades, campamento, etc.)',
          purpose:
            'Apoyan actividades y necesidades específicas del programa cuando se llaman.',
        },
      ],
      en: [
        {
          title: 'Young Women President',
          purpose:
            'Presides over Young Women under the bishop; guides the spiritual growth of young women.',
        },
        {
          title: 'First Counselor',
          purpose:
            'Supports the president; often focuses on classes or program areas as assigned.',
        },
        {
          title: 'Second Counselor',
          purpose:
            'Supports the president; often focuses on other program or class areas.',
        },
        {
          title: 'Young Women Secretary',
          purpose:
            'Keeps records, attendance, and reports for the Young Women program.',
        },
        {
          title: 'Class Advisers',
          purpose:
            'Support the presidency and the young women in a class or age group.',
        },
        {
          title: 'Class Presidency (class presidents and counselors)',
          purpose:
            'Young women lead their class, plan, and strengthen peers under the presidency’s direction.',
        },
        {
          title: 'Specialists (music, activities, camp, etc.)',
          purpose:
            'Support specific program activities and needs when called.',
        },
      ],
    },
  },
  {
    nameEs: 'Hombres Jóvenes',
    nameEn: 'Young Men',
    matchKeys: [
      'hombres jovenes',
      'young men',
      'jovenes hombres',
      'hj',
      'aaronic priesthood',
      'sacerdocio aaronico',
    ],
    feminineLeadershipEs: false,
    callings: {
      es: [
        {
          title: 'Presidente de los Hombres Jóvenes',
          purpose:
            'Apoya al obispado en el cuidado de los poseedores del Sacerdocio Aarónico y el programa de los Hombres Jóvenes.',
        },
        {
          title: 'Consejeros de los Hombres Jóvenes',
          purpose:
            'Apoyan al presidente y trabajan con quórumes o aspectos del programa según se asigne.',
        },
        {
          title: 'Secretario de los Hombres Jóvenes',
          purpose:
            'Lleva registros, asistencia e informes del programa de los Hombres Jóvenes.',
        },
        {
          title: 'Asesores de quórum (Diáconos, Maestros, Presbíteros)',
          purpose:
            'Apoyan al obispado y a la presidencia del quórum de jóvenes en cada quórum del Sacerdocio Aarónico.',
        },
        {
          title: 'Presidencias de quórum (jóvenes)',
          purpose:
            'Los jóvenes llamados como presidente y consejeros lideran su quórum bajo la dirección del obispado.',
        },
        {
          title: 'Especialistas (actividades, campamento, etc.)',
          purpose:
            'Apoyan actividades y necesidades específicas cuando se llaman.',
        },
      ],
      en: [
        {
          title: 'Young Men President',
          purpose:
            'Supports the bishopric in caring for Aaronic Priesthood holders and the Young Men program.',
        },
        {
          title: 'Young Men Counselors',
          purpose:
            'Support the president and work with quorums or program areas as assigned.',
        },
        {
          title: 'Young Men Secretary',
          purpose:
            'Keeps records, attendance, and reports for the Young Men program.',
        },
        {
          title: 'Quorum Advisers (Deacons, Teachers, Priests)',
          purpose:
            'Support the bishopric and youth quorum presidencies in each Aaronic Priesthood quorum.',
        },
        {
          title: 'Youth Quorum Presidencies',
          purpose:
            'Young men called as president and counselors lead their quorum under the bishopric’s direction.',
        },
        {
          title: 'Specialists (activities, camp, etc.)',
          purpose:
            'Support specific activities and needs when called.',
        },
      ],
    },
  },
  {
    nameEs: 'Escuela Dominical',
    nameEn: 'Sunday School',
    matchKeys: [
      'escuela dominical',
      'sunday school',
    ],
    feminineLeadershipEs: false,
    callings: {
      es: [
        {
          title: 'Presidente de la Escuela Dominical',
          purpose:
            'Preside la Escuela Dominical bajo la dirección del obispo; mejora la enseñanza y el aprendizaje del evangelio.',
        },
        {
          title: 'Consejeros de la Escuela Dominical',
          purpose:
            'Apoyan al presidente en la supervisión de clases y la calidad de la enseñanza.',
        },
        {
          title: 'Secretario de la Escuela Dominical',
          purpose:
            'Lleva registros y ayuda a organizar maestros, materiales y horarios.',
        },
        {
          title: 'Maestros de Escuela Dominical',
          purpose:
            'Enseñan las clases del plan de estudio del evangelio a jóvenes y adultos según se asigne.',
        },
        {
          title: 'Especialistas de enseñanza / bibliotecario del barrio (si se llama)',
          purpose:
            'Apoyan recursos de enseñanza y el aprendizaje del evangelio en el barrio.',
        },
      ],
      en: [
        {
          title: 'Sunday School President',
          purpose:
            'Presides over Sunday School under the bishop; improves gospel teaching and learning.',
        },
        {
          title: 'Sunday School Counselors',
          purpose:
            'Support the president in overseeing classes and teaching quality.',
        },
        {
          title: 'Sunday School Secretary',
          purpose:
            'Keeps records and helps organize teachers, materials, and schedules.',
        },
        {
          title: 'Sunday School Teachers',
          purpose:
            'Teach gospel curriculum classes to youth and adults as assigned.',
        },
        {
          title: 'Teaching specialists / ward librarian (if called)',
          purpose:
            'Support teaching resources and gospel learning in the ward.',
        },
      ],
    },
  },
];

export type ResolvedOrganizationCallings = {
  catalog: OrganizationCallingsCatalog;
  /** Display name in the requested language */
  displayName: string;
  callings: OrgCalling[];
};

/**
 * Resolve callings catalog for a free-text organization name from the user profile.
 * Returns null if no known organization matches.
 */
export function resolveOrganizationCallings(
  organizacion: string | null | undefined,
  language: OrgCallingLanguage = 'es',
): ResolvedOrganizationCallings | null {
  const raw = (organizacion ?? '').trim();
  if (!raw) return null;

  const key = normalizeOrgKey(raw);
  if (!key) return null;

  let best: OrganizationCallingsCatalog | null = null;
  let bestScore = 0;

  for (const catalog of ORGANIZATION_CALLINGS) {
    for (const matchKey of catalog.matchKeys) {
      const mk = normalizeOrgKey(matchKey);
      if (!mk) continue;

      let score = 0;
      if (key === mk) score = 100;
      else if (key.includes(mk)) score = 80 + mk.length;
      else if (mk.includes(key) && key.length >= 4) score = 60 + key.length;
      else {
        // token overlap (e.g. "quorum elderes libertad" shouldn't match — only org tokens)
        const keyTokens = new Set(key.split(' ').filter((t) => t.length > 2));
        const mkTokens = mk.split(' ').filter((t) => t.length > 2);
        const overlap = mkTokens.filter((t) => keyTokens.has(t)).length;
        if (overlap > 0 && overlap === mkTokens.length) score = 50 + overlap * 5;
        else if (overlap >= 2) score = 40 + overlap * 5;
      }

      if (score > bestScore) {
        bestScore = score;
        best = catalog;
      }
    }
  }

  if (!best || bestScore < 40) return null;

  return {
    catalog: best,
    displayName: language === 'en' ? best.nameEn : best.nameEs,
    callings: best.callings[language],
  };
}

/**
 * Detects whether the user is asking for the full list of organization callings
 * (e.g. the "Other callings" quick option).
 */
export function isFullCallingsListRequest(message: string): boolean {
  const t = message
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

  if (!t.trim()) return false;

  const hasListIntent =
    t.includes('lista todos') ||
    t.includes('list all') ||
    t.includes('todos los llamamientos') ||
    t.includes('todas las asignaciones') ||
    t.includes('all typical callings') ||
    t.includes('all callings') ||
    t.includes('otros cargos') ||
    t.includes('other callings') ||
    t.includes('que llamamientos estan disponibles') ||
    t.includes('what callings are available') ||
    t.includes('que cargos') ||
    t.includes('which callings');

  if (hasListIntent) return true;

  // Broad: "llamamientos/cargos de {org}" style without a specific role focus
  const asksCallings =
    t.includes('llamamiento') ||
    t.includes('asignacion') ||
    t.includes('cargos') ||
    t.includes('calling') ||
    t.includes('assignment');
  const asksAll =
    t.includes('todos') ||
    t.includes('todas') ||
    t.includes('completo') ||
    t.includes('completa') ||
    t.includes('disponibles') ||
    t.includes('available') ||
    t.includes('tipicos') ||
    t.includes('typical');

  return asksCallings && asksAll;
}

/**
 * Pastoral answer built from the org catalog (no LLM). Used when DeepSeek is
 * slow/unavailable or for the "otros cargos" quick option so the list is complete.
 */
export function buildCatalogCallingsAnswer(
  resolved: ResolvedOrganizationCallings,
  language: OrgCallingLanguage,
): string {
  const items = resolved.callings
    .map((c, i) => `${i + 1}. **${c.title}**\n   ${c.purpose}`)
    .join('\n\n');

  if (language === 'en') {
    return [
      `Here are the **typical callings and assignments** for **${resolved.displayName}**, based on the General Handbook structure.`,
      ``,
      items,
      ``,
      `**Why this structure exists:** each calling helps the presidency care for people, teach the gospel, and organize the work of salvation and exaltation.`,
      ``,
      `**Important:** this is the usual pattern, not a live ward directory. In a specific ward the bishopric decides which specialist callings are filled. For who currently serves in each role, check with your organization's presidency or official Church tools.`,
    ].join('\n');
  }

  return [
    `Estos son los **llamamientos y asignaciones típicos** de **${resolved.displayName}**, según la estructura del Manual General.`,
    ``,
    items,
    ``,
    `**Por qué existe esta estructura:** cada llamamiento ayuda a la presidencia a cuidar a las personas, enseñar el evangelio y organizar la obra de salvación y exaltación.`,
    ``,
    `**Importante:** esta es la estructura habitual, no el directorio actual de tu barrio. En un barrio concreto el obispado decide qué especialistas se llaman. Para saber quién ocupa cada cargo hoy, consulta a la presidencia de tu organización o las herramientas oficiales de la Iglesia.`,
  ].join('\n');
}

/**
 * Format callings as a plain-text block for the AI system prompt.
 */
export function formatCallingsContextBlock(
  resolved: ResolvedOrganizationCallings,
  language: OrgCallingLanguage,
): string {
  const lines = resolved.callings.map(
    (c, i) => `${i + 1}. ${c.title} — ${c.purpose}`,
  );

  if (language === 'en') {
    return [
      `CALLINGS_AND_ASSIGNMENTS for ${resolved.displayName}:`,
      'When the user asks about callings, positions, roles, "other callings", or what assignments this organization has, you MUST list ALL of the following items (do not omit any). For each one, briefly explain what it is and why it exists. You may note that some specialist roles exist only when the bishopric authorizes them in a given ward, but still present the full list as the typical set for this organization.',
      ...lines,
      'Do not invent ward-specific people or who currently holds each calling. This is a structural list, not live directory data.',
    ].join('\n');
  }

  return [
    `LLAMAMIENTOS_Y_ASIGNACIONES de ${resolved.displayName}:`,
    'Cuando el usuario pregunte por llamamientos, cargos, roles, "otros cargos" o qué asignaciones tiene esta organización, DEBES enumerar TODOS los ítems siguientes (sin omitir ninguno). En cada uno explica brevemente qué es y por qué existe. Puedes aclarar que algunos especialistas solo se llaman si el obispado lo autoriza en un barrio concreto, pero igual presenta la lista completa como el conjunto típico de esta organización.',
    ...lines,
    'No inventes personas del barrio ni quién ocupa cada llamamiento hoy. Esta es una lista estructural, no un directorio en vivo.',
  ].join('\n');
}

/** Spanish leadership title variants for quick-option UI labels. */
export function getLeadershipLabels(
  organizacion: string | null | undefined,
  language: OrgCallingLanguage,
): { president: string; counselor: string; secretary: string } {
  if (language === 'en') {
    return {
      president: 'President',
      counselor: 'Counselor',
      secretary: 'Secretary',
    };
  }

  const resolved = resolveOrganizationCallings(organizacion, 'es');
  const feminine =
    resolved?.catalog.feminineLeadershipEs ??
    (() => {
      const key = normalizeOrgKey(organizacion ?? '');
      return (
        key.includes('socorro') ||
        key.includes('relief') ||
        key.includes('mujeres') ||
        key.includes('young women') ||
        key.includes('primaria') ||
        key.includes('primary')
      );
    })();

  if (feminine) {
    return {
      president: 'Presidenta',
      counselor: 'Consejera',
      secretary: 'Secretaria',
    };
  }

  return {
    president: 'Presidente',
    counselor: 'Consejero',
    secretary: 'Secretario',
  };
}
