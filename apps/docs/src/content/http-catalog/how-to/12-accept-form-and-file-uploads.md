# How to accept form bodies and file uploads

A backend written for browsers and REST clients does not only take JSON. It takes
`application/x-www-form-urlencoded` forms, `multipart/form-data` uploads, `+json` variants such as
`application/merge-patch+json`, and occasionally raw `text/plain`. This page is how to expose each
of them as a tool, and how a file gets to your endpoint without the agent writing it into its own
context.

The normative rules are in
[`packages/http/spec/request-bodies.md`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/packages/http/spec/request-bodies.md);
where this page and the spec differ, the spec wins.

## What you get for free

Nothing changes for the agent: it always sends a JSON object of arguments. The SDK decides how
those arguments go on the wire, from what your framework already says about the endpoint.

- **`[Consumes]` and JSON variants.** On ASP.NET Core the media type comes from the endpoint's
  accepts metadata, so `[Consumes("application/merge-patch+json")]` is sent as exactly that. Before
  this, such an endpoint was listed and answered every call with 415.
- **Forms.** A `[FromForm]` DTO, a minimal-API `[FromForm]` parameter, or a Nest `@Body()` with
  `consumes` set to urlencoded becomes a tool whose arguments are the form's fields. A nested
  object is one level deep and is written `address.city` on ASP.NET Core and `address[city]` on
  Nest, the notation each framework's binder reads.
- **Files.** `IFormFile`, `IFormFileCollection`, and a Nest `FileInterceptor` with its field declared
  become multipart file fields.
- **JSON Patch.** A `JsonPatchDocument<T>` body, from either the Newtonsoft or the System.Text.Json
  package, is published as the RFC 6902 operation array the agent sends as `body`:
  `[{ "op": "replace", "path": "/status", "value": "shipped" }]`.

## Declare what cannot be read

Nest keeps a file interceptor's field name in a closure, so it cannot be discovered. Declare it:

```ts
@Post("upload")
@McpTool({ files: { attachment: { mediaType: "text/csv" } } })
@UseInterceptors(FileInterceptor("attachment"))
upload(@UploadedFile() file: UploadedPart | undefined, @Body() body: TitleForm) {
  return { title: body.title, file: describePart(file) };
}
```

`multiple: true` covers a `FilesInterceptor`. An `@ApiBody` schema that marks the field
`format: "binary"` is read too, so a backend already documented for Swagger needs nothing new.
Without either, the endpoint is dropped with `unresolved_file_field` rather than guessed at.

When discovery cannot see the media type, name it:

```ts
@Post("tickets")
@McpTool({ consumes: "application/x-www-form-urlencoded" })
ticket(@Body() body: TicketForm, @Req() req: Request) { ... }
```

`[McpTool(Consumes = "...")]` is the ASP.NET Core twin; there the media type is usually already on
the endpoint as `[Consumes]` or minimal-API accepts metadata.

The declaration has to be one the endpoint accepts; otherwise it is `content_type_not_accepted`.

## What the agent sends for a file

A file argument carries exactly one source:

```json
{ "attachment": { "text": "a,b\n1,2", "name": "report.csv" } }
{ "avatar": { "base64": "iVBORw==", "name": "me.png" } }
{ "attachment": { "ref": "att-1" } }
```

- `text` is for content the agent produced itself — a CSV, a note, a generated document. It costs
  nothing extra: the agent already wrote those tokens.
- `base64` is for small binary files. Every byte of it is model output, so it is capped by
  `invoke.maxInlineFileBytes` (1 MiB by default, summed over the call) and refused, not truncated,
  above that.
- `ref` is a handle your own storage resolves. It is offered only when you bind a resolver.

## Bind a resolver for large files

A `ref` is how a file the user attached, or one another tool stored, reaches your endpoint without
passing through the agent. liaiso names no storage; you implement one method. The two resolvers
below are the in-memory ones the SDKs' own host tests run against; yours looks the ref up in your
store instead of a dictionary.

```csharp
private sealed class MemoryResolver : ILiaisoFileResolver
{
    public string RefDescription => "An attachment id returned by upload_attachment.";

    public async ValueTask<FileResolution> ResolveAsync(
        FileResolveRequest request, CancellationToken cancellationToken)
    {
        return request.Ref switch
        {
            "att-1" => new FileResolution.Resolved("id,total\n1,10\n"u8.ToArray(), "rapor.csv", "text/csv"),
            "att-denied" => new FileResolution.Refused(FileRefusal.Forbidden),
            _ => new FileResolution.Refused(FileRefusal.NotFound),
        };
    }
}

builder.Services.AddSingleton<ILiaisoFileResolver>(_resolver);
```

```ts
class MemoryResolver implements FileResolver {
  readonly refDescription = "An attachment id returned by upload_attachment.";

  resolve(request: FileResolveRequest) {
    if (request.ref === "att-denied") {
      return Promise.resolve({
        ok: false as const,
        reason: "forbidden" as const,
      });
    }
    const bytes = stored[request.ref];
    return Promise.resolve(
      bytes === undefined
        ? { ok: false as const, reason: "not_found" as const }
        : {
            ok: true as const,
            bytes,
            filename: "rapor.csv",
            mediaType: "text/csv",
          },
    );
  }
}

LiaisoModule.forRoot((options) => {
  options.files.resolver = resolver;
});
```

**Authorize the ref against the caller.** A ref is a string the agent wrote; the SDK checks nothing
about it. `not_found` and `forbidden` produce the same message on purpose, so an agent cannot use
the error to find out which refs exist.

The resolver runs inside the invoke deadline and is handed the cancellation signal, so a slow
store surfaces as `invoke_timeout`. A resolved file over `invoke.maxFileBytes` (16 MiB by default)
is refused with `file_too_large`; the limit is passed to the resolver so it can refuse before
loading.

## When an endpoint still does not appear

Four codes are specific to bodies, and each drops only the endpoint it names:

- `unsupported_binding` — a media type liaiso has no writer for, such as `application/xml`, or a
  raw-body binding.
- `unsupported_body_shape` — a free-form form body, a second level of nesting, an array of objects,
  or a file in a urlencoded body.
- `form_antiforgery_required` — an ASP.NET Core form endpoint requires antiforgery. Opt it out with
  `.DisableAntiforgery()` if browsers do not reach it.
- `body_parser_missing` — Nest has no parser for the media type; `app.useBodyParser("text")` adds
  one for `text/plain`.

liaiso never bypasses antiforgery for you. A synthetic request carries no token, and turning off a
security control is your decision.

## Known gaps

- On Nest, a `+json` endpoint is sent as `application/json`: Express's default JSON parser reads
  nothing else, and Nest has no 415 filter to object. Declare `consumes` if you registered a
  parser for the variant.
- Bodies are held in memory, so the peak is `invoke.maxFileBytes` times the number of concurrent
  calls.
