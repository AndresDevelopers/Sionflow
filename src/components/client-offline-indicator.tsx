'use client';

import { useOffline } from '@/hooks/use-offline';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    WifiOff,
    Wifi,
    Download,
    RefreshCw,
    CheckCircle,
    Clock,
    Smartphone,
    X,
    ChevronDown,
    ChevronUp
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect, useRef } from 'react';

function ClientOfflineIndicator() {
    const {
        isOnline,
        isInstalled,
        syncInProgress,
        queuedOperations,
        forceSync,
        installApp,
        canInstall
    } = useOffline();

    const { toast } = useToast();
    const [showOnlineIndicator, setShowOnlineIndicator] = useState(false);
    const [wasOffline, setWasOffline] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [showInstalledIndicator, setShowInstalledIndicator] = useState(false);
    const installTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [offlineMinimized, setOfflineMinimized] = useState(false);

    // Helpers to ensure the installed banner shows only once
    const hasShownInstallBannerBefore = () => {
        try {
            return localStorage.getItem('pwaToastShown') === 'true';
        } catch {
            return false;
        }
    };

    const markInstallBannerShown = () => {
        try {
            localStorage.setItem('pwaToastShown', 'true');
        } catch {
            // ignore storage errors
        }
    };

    // Effect to handle online/offline state changes
    useEffect(() => {
        queueMicrotask(() => {
            if (!isOnline) {
                setWasOffline(true);
                setShowOnlineIndicator(false);
                if (timeoutRef.current) {
                    clearTimeout(timeoutRef.current);
                }
                try {
                    const saved = localStorage.getItem('offlineBannerMinimized');
                    if (saved === 'true') setOfflineMinimized(true);
                } catch {}
            } else if (wasOffline && isOnline) {
                setShowOnlineIndicator(true);
                
                timeoutRef.current = setTimeout(() => {
                    setShowOnlineIndicator(false);
                }, 5000);
            }
        });

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [isOnline, wasOffline]);

    const toggleOfflineMinimized = () => {
        setOfflineMinimized(prev => {
            const next = !prev;
            try { localStorage.setItem('offlineBannerMinimized', next ? 'true' : 'false'); } catch {}
            return next;
        });
    };

    // Show install banner only once and auto-hide after 5s
    useEffect(() => {
        if (!isInstalled) return;
        if (hasShownInstallBannerBefore()) return;

        queueMicrotask(() => {
            setShowInstalledIndicator(true);
        });
        installTimeoutRef.current = setTimeout(() => {
            setShowInstalledIndicator(false);
            markInstallBannerShown();
        }, 5000);

        return () => {
            if (installTimeoutRef.current) clearTimeout(installTimeoutRef.current);
        };
    }, [isInstalled]);

    // Manual close handler
    const handleCloseOnlineIndicator = () => {
        setShowOnlineIndicator(false);
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
    };

    const handleInstall = async () => {
        try {
            await installApp();
            toast({
                title: "App Instalada",
                description: "QuorumFlow se ha instalado correctamente en tu dispositivo.",
            });
        } catch (error) {
            console.error('Installation error:', error);
            toast({
                title: "Error de Instalación",
                description: "No se pudo instalar la aplicación.",
                variant: "destructive"
            });
        }
    };

    // Manual close for installed banner
    const handleCloseInstalledIndicator = () => {
        setShowInstalledIndicator(false);
        if (installTimeoutRef.current) clearTimeout(installTimeoutRef.current);
        markInstallBannerShown();
    };

    const handleSync = async () => {
        try {
            await forceSync();
            toast({
                title: "Sincronización Completa",
                description: "Todos los datos se han sincronizado correctamente.",
            });
        } catch (error) {
            console.error('Sync error:', error);
            toast({
                title: "Error de Sincronización",
                description: "No se pudo completar la sincronización.",
                variant: "destructive"
            });
        }
    };

    return (
        <div className="fixed bottom-4 right-4 z-50 space-y-2">
            {/* Connection Status - Only show offline or online notification */}
            {(!isOnline || showOnlineIndicator) && (
                isOnline ? (
                    <Card className={`w-80 transition-all duration-300 bg-green-50 border-green-200`}>
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Wifi className="h-4 w-4 text-green-600" />
                                    <span className={`text-sm font-medium text-green-700`}>
                                        En línea
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {queuedOperations > 0 && (
                                        <Badge variant="secondary" className="text-xs">
                                            <Clock className="h-3 w-3 mr-1" />
                                            {queuedOperations} pendiente{queuedOperations !== 1 ? 's' : ''}
                                        </Badge>
                                    )}
                                    {queuedOperations > 0 && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={handleSync}
                                            disabled={syncInProgress}
                                            className="h-8"
                                        >
                                            {syncInProgress ? (
                                                <RefreshCw className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <RefreshCw className="h-3 w-3" />
                                            )}
                                        </Button>
                                    )}
                                    {showOnlineIndicator && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={handleCloseOnlineIndicator}
                                            className="h-8 w-8 p-0"
                                        >
                                            <X className="h-3 w-3" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                            {showOnlineIndicator && (
                                <p className="text-xs text-green-600 mt-2">
                                    Conexión restablecida. Los datos se están sincronizando automáticamente.
                                </p>
                            )}
                        </CardContent>
                    </Card>
                ) : offlineMinimized ? (
                    <Card className="w-80 bg-red-50 border-red-200">
                        <CardContent className="p-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <WifiOff className="h-4 w-4 text-red-600" />
                                    <span className="text-sm font-medium text-red-700">Sin conexión</span>
                                </div>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={toggleOfflineMinimized}
                                    className="h-8 w-8 p-0"
                                >
                                    <ChevronUp className="h-3 w-3" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <Card className="w-80 bg-red-50 border-red-200">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <WifiOff className="h-4 w-4 text-red-600" />
                                    <span className="text-sm font-medium text-red-700">Sin conexión</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {queuedOperations > 0 && (
                                        <Badge variant="secondary" className="text-xs">
                                            <Clock className="h-3 w-3 mr-1" />
                                            {queuedOperations} pendiente{queuedOperations !== 1 ? 's' : ''}
                                        </Badge>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={toggleOfflineMinimized}
                                        className="h-8 w-8 p-0"
                                        title="Minimizar"
                                    >
                                        <ChevronDown className="h-3 w-3" />
                                    </Button>
                                </div>
                            </div>
                            <p className="text-xs text-red-600 mt-2">
                                Trabajando sin conexión. Los cambios se sincronizarán automáticamente cuando vuelvas a estar en línea.
                            </p>
                            {syncInProgress && (
                                <p className="text-xs text-blue-600 mt-2 flex items-center gap-1">
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                    Sincronizando datos...
                                </p>
                            )}
                        </CardContent>
                    </Card>
                )
            )}

{/* App Installed Confirmation - show once, auto-hide, manual close */}
            {showInstalledIndicator && (
                <Card className="w-80 bg-green-50 border-green-200">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-green-700">
                            <CheckCircle className="h-4 w-4" />
                            <span className="text-sm font-medium">App Instalada</span>
                            </div>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={handleCloseInstalledIndicator}
                                className="h-8 w-8 p-0"
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </div>
                        <p className="text-xs text-green-600 mt-1">
                            QuorumFlow está instalado y funciona completamente offline.
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

export default ClientOfflineIndicator;
