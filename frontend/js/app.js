/**
 * Application entry point. Feature modules are loaded before this file in index.html.
 */
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    trackAnalyticsEvent('page_view', window.location.pathname);
});
