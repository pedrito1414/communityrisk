// Shared by the existing finder and the explorer preview.
export function validPostcode(value) {
  return /^(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i.test(value);
}

export async function lookupPostcode(postcode, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, {once:true});
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(postcode), {
      signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer'
    });
    if (response.status === 404) throw new Error('Postcode not found. Please check it and try again.');
    if (!response.ok) throw new Error('The postcode service is unavailable. Please try again later.');
    const body = await response.json();
    if (body.status !== 200 || !body.result) throw new Error('Postcode not found.');
    if (!Number.isFinite(body.result.longitude) || !Number.isFinite(body.result.latitude)) {
      throw new Error('A location is not available for this postcode. Please choose an area instead.');
    }
    return body.result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The postcode lookup was cancelled or took too long. Please try again.');
    if (error instanceof TypeError) throw new Error('The postcode service could not be reached. Please try again or choose an area.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
