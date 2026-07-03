import * as functions from "firebase-functions/v1";
export declare const cleanupProfilePictures: functions.CloudFunction<functions.storage.ObjectMetadata>;
export declare const generateCompleteReport: functions.HttpsFunction & functions.Runnable<any>;
export declare const generateReport: functions.HttpsFunction & functions.Runnable<any>;
export declare const onActivityCreated: functions.CloudFunction<functions.firestore.QueryDocumentSnapshot>;
export declare const onActivityUpdated: functions.CloudFunction<functions.Change<functions.firestore.QueryDocumentSnapshot>>;
export declare const onActivityDeleted: functions.CloudFunction<functions.firestore.QueryDocumentSnapshot>;
export declare const onServiceCreated: functions.CloudFunction<functions.firestore.QueryDocumentSnapshot>;
export declare const onServiceUpdated: functions.CloudFunction<functions.Change<functions.firestore.QueryDocumentSnapshot>>;
export declare const onServiceDeleted: functions.CloudFunction<functions.firestore.QueryDocumentSnapshot>;
export declare const onUrgentFamilyFlagged: functions.CloudFunction<functions.Change<functions.firestore.QueryDocumentSnapshot>>;
export declare const onMissionaryAssignmentCreated: functions.CloudFunction<functions.firestore.QueryDocumentSnapshot>;
export declare const dailyNotifications: functions.CloudFunction<unknown>;
export declare const weeklyNotifications: functions.CloudFunction<unknown>;
export declare const councilNotifications: functions.CloudFunction<unknown>;
//# sourceMappingURL=index.d.ts.map