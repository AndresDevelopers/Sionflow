import { getAppName, getAppDescription, getSiteUrl, getAppIcon } from "@/lib/app-config";

/**
 * JSON-LD Structured Data — invisible al usuario, crítico para AEO/GEO.
 * Schema.org: WebApplication + FAQPage para que buscadores e IAs
 * entiendan qué es la app, qué resuelve y cómo usarla.
 */
export function JsonLd() {
  const appName = getAppName();
  const appDescription = getAppDescription();
  const siteUrl = getSiteUrl();
  const appIcon = getAppIcon();

  const webApplicationSchema = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: appName,
    url: siteUrl,
    description: appDescription,
    image: appIcon,
    applicationCategory: "BusinessApplication",
    operatingSystem: "All",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    browserRequirements: "requires HTML5 support",
    softwareVersion: "2.0",
    screenshot: appIcon,
    featureList: [
      "Gestión de miembros del Quorum de Elderes y Sociedad de Socorro",
      "Seguimiento de conversos y futuros miembros",
      "Asignación de compañerismos de ministerio",
      "Obra misional y amistades",
      "Informes de actividad y bautismos",
      "Consejo de barrio y agenda",
      "Asistente IA para consultas doctrinales (church-chat)",
      "Notificaciones PWA push",
    ],
    author: {
      "@type": "Organization",
      name: appName,
      url: siteUrl,
    },
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `¿Qué es ${appName}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `${appName} es un sistema de gestión integral para presidencias del Quorum de Elderes y la Sociedad de Socorro. Permite administrar miembros, conversos, ministerio, obra misional, informes de actividad y consejo de barrio, con inteligencia artificial integrada para consultas doctrinales y análisis de datos.`,
        },
      },
      {
        "@type": "Question",
        name: `¿Cómo usar ${appName} para la presidencia del Quorum de Elderes o Sociedad de Socorro?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Accede con tu cuenta autorizada para gestionar miembros, asignar compañerismos de ministerio, hacer seguimiento de conversos y futuros miembros, registrar informes de actividad, coordinar el consejo de barrio y consultar al asistente IA para orientación doctrinal y administrativa.`,
        },
      },
      {
        "@type": "Question",
        name: `¿Qué funcionalidades ofrece ${appName}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Ofrece gestión de miembros, seguimiento de conversos, asignación de ministerio, obra misional, cumpleaños, informes de actividad, bautismos, consejo de barrio, búsqueda familiar, donaciones, chat IA para consultas doctrinales (church-chat), notificaciones push PWA y panel de administración.`,
        },
      },
      {
        "@type": "Question",
        name: `¿${appName} funciona en dispositivos móviles?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Sí, ${appName} es una PWA (Progressive Web App) que funciona en cualquier dispositivo con navegador moderno. Se puede instalar en la pantalla de inicio del teléfono y usar sin conexión a internet gracias al modo offline.`,
        },
      },
    ],
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: appName,
    url: siteUrl,
    description: appDescription,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl}/?s={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(webApplicationSchema),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqSchema),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbSchema),
        }}
      />
    </>
  );
}
