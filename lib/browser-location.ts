type BrowserCoordinates = { latitude: number; longitude: number };
export type BrowserPosition = { coords: BrowserCoordinates };
export type BrowserLocationError = { code: number; message?: string };
type PositionOptions = { enableHighAccuracy: boolean; timeout: number; maximumAge: number };
type PositionRequester = (
  success: (position: BrowserPosition) => void,
  failure: (error: BrowserLocationError) => void,
  options: PositionOptions,
) => void;

export async function requestBrowserPosition(request: PositionRequester): Promise<BrowserPosition> {
  try {
    return await requestOnce(request, { enableHighAccuracy: false, timeout: 12_000, maximumAge: 600_000 });
  } catch (error) {
    const locationError = error as BrowserLocationError;
    if (locationError.code === 1) throw locationError;
    return requestOnce(request, { enableHighAccuracy: true, timeout: 25_000, maximumAge: 0 });
  }
}

function requestOnce(request: PositionRequester, options: PositionOptions) {
  return new Promise<BrowserPosition>((resolve, reject) => request(resolve, reject, options));
}
