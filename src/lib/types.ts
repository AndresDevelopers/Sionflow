
import { Timestamp } from 'firebase/firestore';

export type Family = {
    name: string;
    isUrgent: boolean;
    observation: string;
    memberId?: string;
};

export type Companionship = {
    id: string;
    companions: string[];
    families: Family[];
    /** Distrito asignado (fuente de verdad en el compañerismo para filtrar) */
    districtId?: string | null;
    /** Multi-tenant scope key: "barrio|organización" */
    barrioOrg?: string;
};

/**
 * Entrevista programada a un compañerismo de ministración.
 * El dueño del distrito (líder = miembro con cuenta sincronizada) recibe
 * recordatorios 4 días y 1 día antes vía in-app + push (Cloud Function).
 */
export type MinisteringInterviewStatus = 'scheduled' | 'completed';

export type MinisteringInterview = {
    id: string;
    companionshipId: string;
    /** Nombre legible del compañerismo (p. ej. "Juan y Pedro") — generado, no editable */
    companionshipName: string;
    /**
     * Personas del compañerismo que asisten a la entrevista (multi-selección).
     * Legacy docs may only have intervieweeName.
     */
    intervieweeNames: string[];
    /** @deprecated Prefer intervieweeNames */
    intervieweeName?: string;
    districtId?: string | null;
    /** memberId del líder del distrito al momento de programar */
    leaderMemberId?: string | null;
    leaderName?: string | null;
    /** Día de la entrevista (fecha calendario) */
    date: Timestamp;
    /** Hora local "HH:mm" */
    time: string;
    /** scheduled por defecto; completed al marcar como realizada */
    status?: MinisteringInterviewStatus;
    /** Nota al completar la entrevista (opcional) */
    observation?: string | null;
    completedAt?: Timestamp | null;
    completedBy?: string | null;
    updatedAt?: Timestamp;
    barrioOrg: string;
    createdAt: Timestamp;
    createdBy: string;
};

export type MinisteringDistrict = {
    id: string;
    name: string;
    companionshipIds: string[];
    leaderId?: string | null;
    leaderName?: string | null;
    /** Distrito 1 por defecto: no se puede eliminar desde la UI */
    isDefault?: boolean;
    updatedAt?: Timestamp;
};

export type Convert = {
    id: string;
    name: string;
    baptismDate: Timestamp;
    photoURL?: string;
    councilCompleted?: boolean;
    councilCompletedAt?: Timestamp | null;
    observation?: string;
    missionaryReference?: string;
    memberId?: string;
};

export type FutureMember = {
    id: string;
    name: string;
    baptismDate: Timestamp;
    photoURL?: string;
    baptismPhotos?: string[];
    isBaptized?: boolean;
};

export type Activity = {
    id: string;
    title: string;
    date: Timestamp;
    description: string;
    time?: string;
    imageUrls?: string[];
    location?: string;
    context?: string;
    learning?: string;
    additionalText?: string;
}

/** Tipo de ayuda registrada desde FamilySearch → sección Ayuda */
export type FamilySearchHelpType = 'create_account' | 'other';

export type Annotation = {
    id: string;
    text: string;
    isCouncilAction: boolean;
    isResolved: boolean;
    source: 'dashboard' | 'council' | 'family-search' | 'missionary-work' | 'service' | 'activities';
    createdAt: Timestamp;
    userId: string;
    /** Opcional: miembro relacionado (p. ej. ayuda FamilySearch) */
    memberId?: string;
    /** Tipo de ayuda FS (create_account se elimina al marcar Completado) */
    helpType?: FamilySearchHelpType;
}

export type Birthday = {
    id: string;
    name: string;
    birthDate: Timestamp;
    photoURL?: string;
    isMember?: boolean;
    memberId?: string;
    memberStatus?: MemberStatus;
};

export type Baptism = {
    id: string;
    name: string;
    date: Timestamp;
    source: 'Manual' | 'Automático' | 'Nuevo Converso' | 'Futuro Miembro';
    photoURL?: string;
    baptismPhotos?: string[];
    observation?: string;
    memberId?: string;
}

export type FamilySearchTraining = {
    id: string;
    familyName: string;
    createdAt: Timestamp;
    // Optional member reference if selected from existing members
    memberId?: string;
    memberName?: string; // Store member's full name for display
}

export type FamilySearchTask = {
    id: string;
    task: string;
    createdAt: Timestamp;
}

export type FamilySearchAnnotation = {
    id: string;
    note: string;
    createdAt: Timestamp;
}

export type MissionaryAssignment = {
    id: string;
    description: string;
    time?: string;
    isCompleted: boolean;
    createdAt: Timestamp;
    userId: string;
}

export type Investigator = {
    id: string;
    name: string;
    assignedMissionaries: string;
    status: 'active' | 'baptized';
    createdAt: Timestamp;
    convertId?: string;
    linkedAt?: Timestamp;
}

export type NewConvertFriendship = {
    id: string;
    convertId: string;
    convertName: string;
    friends: string[];
    assignedAt: Timestamp;
}

export type MissionaryImage = {
    id: string;
    imageUrl: string;
    description: string;
    createdAt: Timestamp;
    createdBy: string;
}

export type Service = {
    id: string;
    title: string;
    date: Timestamp;
    description: string;
    time?: string;
    councilNotified?: boolean;
    imageUrls?: string[];
}

export type HealthConcern = {
    id: string;
    firstName: string;
    lastName: string;
    helperIds: string[];
    helperNames: string[];
    address: string;
    observation: string;
    photoURL?: string;
    photoPath?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    createdBy: string;
};

export type AppNotification = {
    id: string;
    userId: string;
    title: string;
    body: string;
    createdAt: Timestamp;
    isRead: boolean;
    /**
     * Soft-delete: user dismissed from the in-app bell.
     * Kept as a doc so deterministic CF/API creates (same user+tag+day) stay
     * idempotent and do not reappear after the user cleared them.
     */
    isDismissed?: boolean;
    // Navigation data for clickable notifications
    actionUrl?: string;
    actionType?: 'navigate' | 'external';
    // Context data to determine navigation route
    contextType?:
    | 'convert'
    | 'activity'
    | 'service'
    | 'member'
    | 'council'
    | 'baptism'
    | 'birthday'
    | 'investigator'
    | 'urgent_family'
    | 'missionary_assignment'
    | 'admin_user'
    | 'ministering_interview';
    contextId?: string;
    notificationTag?: string | null;
    barrioOrg?: string | null;
}

// Member management types
export type MemberStatus = 'active' | 'less_active' | 'inactive' | 'deceased';

// Ordenanzas disponibles
export type Ordinance =
    | 'baptism'
    | 'confirmation'
    | 'elder_ordination'
    | 'endowment'
    | 'sealed_spouse'
    | 'sealed_to_father'
    | 'sealed_to_mother'
    | 'high_priest_ordination'
    | 'aronico_ordination';

export const OrdinanceLabels: Record<Ordinance, string> = {
    baptism: 'Bautismo',
    confirmation: 'Confirmación',
    elder_ordination: 'Ordenado élder',
    endowment: 'Investidura',
    sealed_spouse: 'Sellado(a) al cónyuge',
    sealed_to_father: 'Sellamiento al padre',
    sealed_to_mother: 'Sellamiento a la madre',
    high_priest_ordination: 'Ordenado sumo sacerdote',
    aronico_ordination: 'Ordenado Aarónico'
};

// Ordenanzas para obra vicaria (miembros deceased)
export type TempleOrdinance =
    | 'baptism'
    | 'confirmation'
    | 'initiatory'
    | 'endowment'
    | 'sealed_to_father'
    | 'sealed_to_mother'
    | 'sealed_to_spouse'
    | 'sealed_spouse'
    | 'elder_ordination'
    | 'high_priest_ordination'
    | 'aronico_ordination';

export const TempleOrdinanceLabels: Record<TempleOrdinance, string> = {
    baptism: 'Bautismo',
    confirmation: 'Confirmación',
    initiatory: 'Iniciatoria',
    endowment: 'Investidura',
    sealed_to_father: 'Sellamiento al padre',
    sealed_to_mother: 'Sellamiento a la madre',
    sealed_to_spouse: 'Sellamiento al cónyuge',
    sealed_spouse: 'Sellado(a) al cónyuge',
    elder_ordination: 'Ordenado élder',
    high_priest_ordination: 'Ordenado sumo sacerdote',
    aronico_ordination: 'Ordenado Aarónico'
};

/** Estado del árbol genealógico en FamilySearch */
export type FamilySearchTreeStatus = 'complete' | 'partial';

export type Member = {
    id: string;
    firstName: string;
    lastName: string;
    /** Multi-tenant scope key: "barrio|organización" */
    barrioOrg?: string;
    photoURL?: string;
    birthDate?: Timestamp;
    baptismDate?: Timestamp; // Fecha de bautismo del miembro
    baptismPhotos?: string[]; // Fotos del bautismo
    deathDate?: Timestamp | null;
    phoneNumber?: string;
    email?: string;
    memberId?: string;
    address?: string; // Dirección del miembro
    status: MemberStatus;
    ordinances?: Ordinance[]; // Ordenanzas recibidas
    // Ministering information
    ministeringTeachers?: string[]; // Nombres de los maestros ministrantes
    createdAt: Timestamp;
    updatedAt: Timestamp;
    createdBy: string;
    // Activity tracking
    lastActiveDate?: Timestamp;
    inactiveSince?: Timestamp | null;
    inactiveObservation?: string;
    // Council tracking
    councilCompleted?: boolean;
    councilCompletedAt?: Timestamp;
    // For less active members tracking
    lessActiveSince?: Timestamp | null;
    lessActiveObservation?: string;
    lessActiveCompletedAt?: Timestamp;
    // Urgent and council flags
    isUrgent?: boolean;
    urgentReason?: string;
    urgentNotifiedAt?: Timestamp;
    isInCouncil?: boolean;
    // Temple work completion tracking for deceased members
    templeWorkCompletedAt?: Timestamp | null;
    // Ordenanzas de obra vicaria para miembros deceased
    templeOrdinances?: TempleOrdinance[];
    /** Tiene cuenta Church Account (ChurchofJesusChrist.org / LDS Account) */
    hasLdsAccount?: boolean;
    /** Tiene cuenta de FamilySearch */
    hasFamilySearchAccount?: boolean;
    /**
     * Marcado en Ayuda FS: el miembro sin cuenta necesita acompañamiento
     * para crear/configurar FamilySearch (genera una anotación).
     */
    needsFamilySearchHelp?: boolean;
    /**
     * Id de la anotación de ayuda "crear cuenta" (se borra al marcar Completado).
     */
    familySearchCreateAccountAnnotationId?: string | null;
    /**
     * Hasta qué generación tiene el árbol en FamilySearch (opcional).
     * Ej: 4 = hasta 4 generaciones.
     */
    familySearchGenerations?: number | null;
    /** Árbol completo o parcial (opcional, si tiene cuenta FS) */
    familySearchTreeStatus?: FamilySearchTreeStatus | null;
    /** Qué está parcial / qué falta (si familySearchTreeStatus === 'partial') */
    familySearchPartialDetails?: string | null;
}
