export const isSSEResponse = (response: Response): boolean => {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("text/event-stream");
};
