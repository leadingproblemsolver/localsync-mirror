const isNode = typeof window === 'undefined';
/** @type {Storage} */
const storage = isNode
	? /** @type {any} */ ({
		getItem: () => null,
		setItem: () => undefined,
		removeItem: () => undefined,
	})
	: window.localStorage;

/** @type {any} */
const importMetaEnv = (typeof import.meta !== 'undefined' && /** @type {any} */ (import.meta).env) || {};

const toSnakeCase = (str) => {
	return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
	if (isNode) {
		return defaultValue;
	}
	const storageKey = `supabase_${toSnakeCase(paramName)}`;
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = urlParams.get(paramName);
	if (removeFromUrl) {
		urlParams.delete(paramName);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
			}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
	}
	if (searchParam) {
		storage.setItem(storageKey, searchParam);
		return searchParam;
	}
	if (defaultValue) {
		storage.setItem(storageKey, defaultValue);
		return defaultValue;
	}
	const storedValue = storage.getItem(storageKey);
	if (storedValue) {
		return storedValue;
	}
	return null;
}

const getAppParams = () => {
	if (getAppParamValue("clear_access_token") === 'true') {
		storage.removeItem('supabase_access_token');
		storage.removeItem('token');
	}
	return {
		supabaseUrl: getAppParamValue("supabase_url", { defaultValue: importMetaEnv.VITE_SUPABASE_URL }),
		supabaseAnonKey: getAppParamValue("supabase_anon_key", { defaultValue: importMetaEnv.VITE_SUPABASE_ANON_KEY }),
		fromUrl: getAppParamValue("from_url", { defaultValue: isNode ? undefined : window.location.href }),
	}
}


export const appParams = {
	...getAppParams()
};

// P3 COLD_START_REPAIR — T-14
// Threshold past which an active incident is considered stale and the
// cold-start repair affordances surface in the UI.
// Gap #6: 7 days was operationally too wide; default tuned to 4 hours,
// override via VITE_STALENESS_THRESHOLD_MS (milliseconds).
const stalenessMs =
  Number(importMetaEnv.VITE_STALENESS_THRESHOLD_MS) || 4 * 60 * 60 * 1000;
export const COLD_START_PARAMS = Object.freeze({
  STALENESS_THRESHOLD_MS: stalenessMs,
});

