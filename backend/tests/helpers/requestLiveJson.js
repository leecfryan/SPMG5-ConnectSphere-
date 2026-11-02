async function requestLiveJson(baseUrl, token, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
}

module.exports = requestLiveJson;
