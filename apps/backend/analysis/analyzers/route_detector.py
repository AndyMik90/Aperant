"""
Route Detector Module
=====================

Detects API routes and endpoints across different frameworks:
- Python: FastAPI, Flask, Django
- Node.js: Express, Next.js
- Go: Gin, Echo, Chi, Fiber
- Rust: Axum, Actix
- C#/.NET: ASP.NET Core (Controllers, Minimal APIs)
- TypeScript: Angular
"""

from __future__ import annotations

import re
from pathlib import Path

from .base import BaseAnalyzer


class RouteDetector(BaseAnalyzer):
    """Detects API routes across multiple web frameworks."""

    # Directories to exclude from route detection
    EXCLUDED_DIRS = {
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        ".git",
        "bin",
        "obj",
    }

    def __init__(self, path: Path):
        super().__init__(path)

    def _should_include_file(self, file_path: Path) -> bool:
        """Check if file should be included (not in excluded directories)."""
        return not any(part in self.EXCLUDED_DIRS for part in file_path.parts)

    def detect_all_routes(self) -> list[dict]:
        """Detect all API routes across different frameworks."""
        routes = []

        # Python FastAPI
        routes.extend(self._detect_fastapi_routes())

        # Python Flask
        routes.extend(self._detect_flask_routes())

        # Python Django
        routes.extend(self._detect_django_routes())

        # Node.js Express/Fastify/Koa
        routes.extend(self._detect_express_routes())

        # Next.js (file-based routing)
        routes.extend(self._detect_nextjs_routes())

        # Go Gin/Echo/Chi
        routes.extend(self._detect_go_routes())

        # Rust Axum/Actix
        routes.extend(self._detect_rust_routes())

        # C#/.NET ASP.NET Core
        routes.extend(self._detect_aspnet_routes())

        # Angular
        routes.extend(self._detect_angular_routes())

        return routes

    def _detect_fastapi_routes(self) -> list[dict]:
        """Detect FastAPI routes."""
        routes = []
        files_to_check = [
            f for f in self.path.glob("**/*.py") if self._should_include_file(f)
        ]

        for file_path in files_to_check:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Pattern: @app.get("/path") or @router.post("/path", dependencies=[...])
            patterns = [
                (
                    r'@(?:app|router)\.(get|post|put|delete|patch)\(["\']([^"\']+)["\']',
                    "decorator",
                ),
                (
                    r'@(?:app|router)\.api_route\(["\']([^"\']+)["\'][^)]*methods\s*=\s*\[([^\]]+)\]',
                    "api_route",
                ),
            ]

            for pattern, pattern_type in patterns:
                matches = re.finditer(pattern, content, re.MULTILINE)
                for match in matches:
                    if pattern_type == "decorator":
                        method = match.group(1).upper()
                        path = match.group(2)
                        methods = [method]
                    else:
                        path = match.group(1)
                        methods_str = match.group(2)
                        methods = [
                            m.strip().strip('"').strip("'").upper()
                            for m in methods_str.split(",")
                        ]

                    # Check if route requires auth (has Depends in the decorator)
                    line_start = content.rfind("\n", 0, match.start()) + 1
                    line_end = content.find("\n", match.end())
                    route_definition = content[
                        line_start : line_end if line_end != -1 else len(content)
                    ]

                    requires_auth = (
                        "Depends" in route_definition
                        or "require" in route_definition.lower()
                    )

                    routes.append(
                        {
                            "path": path,
                            "methods": methods,
                            "file": str(file_path.relative_to(self.path)),
                            "framework": "FastAPI",
                            "requires_auth": requires_auth,
                        }
                    )

        return routes

    def _detect_flask_routes(self) -> list[dict]:
        """Detect Flask routes."""
        routes = []
        files_to_check = [
            f for f in self.path.glob("**/*.py") if self._should_include_file(f)
        ]

        for file_path in files_to_check:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Pattern: @app.route("/path", methods=["GET", "POST"])
            pattern = r'@(?:app|bp|blueprint)\.route\(["\']([^"\']+)["\'](?:[^)]*methods\s*=\s*\[([^\]]+)\])?'
            matches = re.finditer(pattern, content, re.MULTILINE)

            for match in matches:
                path = match.group(1)
                methods_str = match.group(2)

                if methods_str:
                    methods = [
                        m.strip().strip('"').strip("'").upper()
                        for m in methods_str.split(",")
                    ]
                else:
                    methods = ["GET"]  # Flask default

                # Check for @login_required decorator
                decorator_start = content.rfind("@", 0, match.start())
                decorator_section = content[decorator_start : match.end()]
                requires_auth = (
                    "login_required" in decorator_section
                    or "require" in decorator_section.lower()
                )

                routes.append(
                    {
                        "path": path,
                        "methods": methods,
                        "file": str(file_path.relative_to(self.path)),
                        "framework": "Flask",
                        "requires_auth": requires_auth,
                    }
                )

        return routes

    def _detect_django_routes(self) -> list[dict]:
        """Detect Django routes from urls.py files."""
        routes = []
        url_files = [
            f for f in self.path.glob("**/urls.py") if self._should_include_file(f)
        ]

        for file_path in url_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Pattern: path('users/<int:id>/', views.user_detail)
            patterns = [
                r'path\(["\']([^"\']+)["\']',
                r're_path\([r]?["\']([^"\']+)["\']',
            ]

            for pattern in patterns:
                matches = re.finditer(pattern, content)
                for match in matches:
                    path = match.group(1)

                    routes.append(
                        {
                            "path": f"/{path}" if not path.startswith("/") else path,
                            "methods": ["GET", "POST"],  # Django allows both by default
                            "file": str(file_path.relative_to(self.path)),
                            "framework": "Django",
                            "requires_auth": False,  # Can't easily detect without middleware analysis
                        }
                    )

        return routes

    def _detect_express_routes(self) -> list[dict]:
        """Detect Express/Fastify/Koa routes."""
        routes = []
        js_files = [
            f for f in self.path.glob("**/*.js") if self._should_include_file(f)
        ]
        ts_files = [
            f for f in self.path.glob("**/*.ts") if self._should_include_file(f)
        ]
        files_to_check = js_files + ts_files
        for file_path in files_to_check:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Pattern: app.get('/path', handler) or router.post('/path', middleware, handler)
            pattern = (
                r'(?:app|router)\.(get|post|put|delete|patch|use)\(["\']([^"\']+)["\']'
            )
            matches = re.finditer(pattern, content)

            for match in matches:
                method = match.group(1).upper()
                path = match.group(2)

                if method == "USE":
                    # .use() is middleware, might be a route prefix
                    continue

                # Check for auth middleware in the route definition
                line_start = content.rfind("\n", 0, match.start()) + 1
                line_end = content.find("\n", match.end())
                route_line = content[
                    line_start : line_end if line_end != -1 else len(content)
                ]

                requires_auth = any(
                    keyword in route_line.lower()
                    for keyword in ["auth", "authenticate", "protect", "require"]
                )

                routes.append(
                    {
                        "path": path,
                        "methods": [method],
                        "file": str(file_path.relative_to(self.path)),
                        "framework": "Express",
                        "requires_auth": requires_auth,
                    }
                )

        return routes

    def _detect_nextjs_routes(self) -> list[dict]:
        """Detect Next.js file-based routes."""
        routes = []

        # Next.js App Router (app directory)
        app_dir = self.path / "app"
        if app_dir.exists():
            # Find all route.ts/js files
            route_files = [
                f
                for f in app_dir.glob("**/route.{ts,js,tsx,jsx}")
                if self._should_include_file(f)
            ]
            for route_file in route_files:
                # Convert file path to route path
                # app/api/users/[id]/route.ts -> /api/users/:id
                relative_path = route_file.parent.relative_to(app_dir)
                route_path = "/" + str(relative_path).replace("\\", "/")

                # Convert [id] to :id
                route_path = re.sub(r"\[([^\]]+)\]", r":\1", route_path)

                try:
                    content = route_file.read_text(encoding="utf-8")
                    # Detect exported methods: export async function GET(request)
                    methods = re.findall(
                        r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)",
                        content,
                    )

                    if methods:
                        routes.append(
                            {
                                "path": route_path,
                                "methods": methods,
                                "file": str(route_file.relative_to(self.path)),
                                "framework": "Next.js",
                                "requires_auth": "auth" in content.lower(),
                            }
                        )
                except (OSError, UnicodeDecodeError):
                    continue

        # Next.js Pages Router (pages/api directory)
        pages_api = self.path / "pages" / "api"
        if pages_api.exists():
            api_files = [
                f
                for f in pages_api.glob("**/*.{ts,js,tsx,jsx}")
                if self._should_include_file(f)
            ]
            for api_file in api_files:
                if api_file.name.startswith("_"):
                    continue

                # Convert file path to route
                relative_path = api_file.relative_to(pages_api)
                route_path = "/api/" + str(relative_path.with_suffix("")).replace(
                    "\\", "/"
                )

                # Convert [id] to :id
                route_path = re.sub(r"\[([^\]]+)\]", r":\1", route_path)

                routes.append(
                    {
                        "path": route_path,
                        "methods": [
                            "GET",
                            "POST",
                        ],  # Next.js API routes handle all methods
                        "file": str(api_file.relative_to(self.path)),
                        "framework": "Next.js",
                        "requires_auth": False,
                    }
                )

        return routes

    def _detect_go_routes(self) -> list[dict]:
        """Detect Go framework routes (Gin, Echo, Chi, Fiber)."""
        routes = []
        go_files = [
            f for f in self.path.glob("**/*.go") if self._should_include_file(f)
        ]

        for file_path in go_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Gin: r.GET("/path", handler)
            # Echo: e.POST("/path", handler)
            # Chi: r.Get("/path", handler)
            # Fiber: app.Get("/path", handler)
            pattern = r'(?:r|e|app|router)\.(GET|POST|PUT|DELETE|PATCH|Get|Post|Put|Delete|Patch)\(["\']([^"\']+)["\']'
            matches = re.finditer(pattern, content)

            for match in matches:
                method = match.group(1).upper()
                path = match.group(2)

                routes.append(
                    {
                        "path": path,
                        "methods": [method],
                        "file": str(file_path.relative_to(self.path)),
                        "framework": "Go",
                        "requires_auth": False,
                    }
                )

        return routes

    def _detect_rust_routes(self) -> list[dict]:
        """Detect Rust framework routes (Axum, Actix)."""
        routes = []
        rust_files = [
            f for f in self.path.glob("**/*.rs") if self._should_include_file(f)
        ]

        for file_path in rust_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Axum: .route("/path", get(handler))
            # Actix: web::get().to(handler)
            patterns = [
                r'\.route\(["\']([^"\']+)["\'],\s*(get|post|put|delete|patch)',
                r"web::(get|post|put|delete|patch)\(\)",
            ]

            for pattern in patterns:
                matches = re.finditer(pattern, content)
                for match in matches:
                    if len(match.groups()) == 2:
                        path = match.group(1)
                        method = match.group(2).upper()
                    else:
                        path = "/"  # Can't determine path from web:: syntax
                        method = match.group(1).upper()

                    routes.append(
                        {
                            "path": path,
                            "methods": [method],
                            "file": str(file_path.relative_to(self.path)),
                            "framework": "Rust",
                            "requires_auth": False,
                        }
                    )

        return routes

    def _detect_aspnet_routes(self) -> list[dict]:
        """Detect ASP.NET Core routes (Controllers and Minimal APIs)."""
        routes = []
        cs_files = [
            f for f in self.path.glob("**/*.cs") if self._should_include_file(f)
        ]

        for file_path in cs_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # --- Controller-based routes ---
            routes.extend(self._detect_aspnet_controller_routes(file_path, content))

            # --- Minimal API routes ---
            routes.extend(self._detect_aspnet_minimal_api_routes(file_path, content))

        return routes

    def _normalize_aspnet_path(self, path: str) -> str:
        """Normalize ASP.NET route path: convert {param} and {param:type} to :param format."""
        # Convert {param:constraint} to :param (e.g., {id:int} -> :id)
        path = re.sub(r"\{(\w+):[^}]+\}", r":\1", path)
        # Convert {param} to :param (e.g., {id} -> :id)
        path = re.sub(r"\{(\w+)\}", r":\1", path)
        # Ensure leading slash
        if path and not path.startswith("/"):
            path = "/" + path
        return path

    def _detect_aspnet_controller_routes(
        self, file_path: Path, content: str
    ) -> list[dict]:
        """Detect routes from ASP.NET Core controller classes."""
        routes = []

        # Check if this file contains [ApiController] or inherits from Controller/ControllerBase
        is_controller = bool(
            re.search(r"\[ApiController\]|:\s*(?:Controller|ControllerBase)\b", content)
        )
        if not is_controller:
            return routes

        # Extract class name
        class_match = re.search(r"class\s+(\w+)", content)
        if not class_match:
            return routes
        class_name = class_match.group(1)

        # Derive controller name (strip "Controller" suffix, lowercase)
        controller_name = class_name
        if controller_name.endswith("Controller"):
            controller_name = controller_name[: -len("Controller")]
        controller_name = controller_name.lower()

        # Find class-level [Route("...")] attribute
        class_route_prefix = ""
        # Look for [Route("...")] in the ~500 chars before the class declaration
        class_decl_pos = class_match.start()
        pre_class_section = content[max(0, class_decl_pos - 500) : class_decl_pos]
        # Find the last [Route("...")] before the class (closest to class declaration)
        route_attr_matches = list(
            re.finditer(r'\[Route\(["\']([^"\']+)["\']\)\]', pre_class_section)
        )
        if route_attr_matches:
            class_route_prefix = route_attr_matches[-1].group(1)

        # Replace [controller] placeholder with actual controller name
        class_route_prefix = class_route_prefix.replace("[controller]", controller_name)

        # Detect class-level [Authorize]
        class_authorize = bool(re.search(r"\[Authorize", pre_class_section))

        # Find all [Http*] attributed methods
        http_method_pattern = re.compile(
            r'\[(Http(?:Get|Post|Put|Delete|Patch))(?:\(["\']([^"\']*)["\'](?:,[^]]*?)?\))?\]',
            re.MULTILINE,
        )

        for match in http_method_pattern.finditer(content):
            attr_name = match.group(1)  # e.g., "HttpGet"
            method_route = match.group(2) or ""  # e.g., "path" or ""

            # Map attribute to HTTP method
            method_map = {
                "HttpGet": "GET",
                "HttpPost": "POST",
                "HttpPut": "PUT",
                "HttpDelete": "DELETE",
                "HttpPatch": "PATCH",
            }
            http_method = method_map.get(attr_name, "GET")

            # Build full path from class prefix + method route
            full_path = class_route_prefix
            if method_route:
                if full_path and not full_path.endswith("/"):
                    full_path += "/"
                full_path += method_route

            # Replace [action] with method name (find the method after the attribute)
            method_name_match = re.search(
                r"(?:public|private|protected|internal)\s+\S+\s+(\w+)\s*\(",
                content[match.end() : match.end() + 300],
            )
            if method_name_match:
                method_name = method_name_match.group(1).lower()
                full_path = full_path.replace("[action]", method_name)

            # Normalize path params
            full_path = self._normalize_aspnet_path(full_path)

            # Check for method-level [Authorize]
            # Look backwards from [Http*] to the previous method end (}) or class opening
            # and forward to the method signature opening (
            attr_before_start = max(0, match.start() - 300)
            pre_section = content[attr_before_start : match.start()]
            # Find the last } or { before this attribute to bound the search
            last_brace = max(pre_section.rfind("}"), pre_section.rfind("{"))
            if last_brace >= 0:
                pre_section = pre_section[last_brace + 1 :]

            # Also check attributes between [Http*] and the method signature
            post_section = content[match.end() : match.end() + 200]
            # Stop at the method body opening brace
            brace_pos = post_section.find("{")
            if brace_pos >= 0:
                post_section = post_section[:brace_pos]

            method_authorize = bool(
                re.search(r"\[Authorize", pre_section)
                or re.search(r"\[Authorize", post_section)
            )

            requires_auth = class_authorize or method_authorize

            routes.append(
                {
                    "path": full_path,
                    "methods": [http_method],
                    "file": str(file_path.relative_to(self.path)),
                    "framework": "ASP.NET Core",
                    "requires_auth": requires_auth,
                }
            )

        return routes

    def _detect_aspnet_minimal_api_routes(
        self, file_path: Path, content: str
    ) -> list[dict]:
        """Detect routes from ASP.NET Core Minimal APIs.

        Supports both direct mapping (app.MapGet) and group-based mapping
        (var root = app.MapGroup("/prefix"); root.MapGet("/path", ...)).
        """
        routes = []

        # Step 1: Detect MapGroup base paths and their auth status
        # Pattern: var root = app.MapGroup("/api/v1/orders")...RequireAuthorization()
        group_prefixes: dict[str, tuple[str, bool]] = {}  # var_name -> (prefix, auth)
        group_pattern = re.compile(
            r'(?:var|_)\s+(\w+)\s*=\s*\w+\s*\.\s*MapGroup\s*\(\s*["\']([^"\']+)["\']',
            re.MULTILINE,
        )
        for match in group_pattern.finditer(content):
            var_name = match.group(1)
            prefix = match.group(2).rstrip("/")
            # Check if the group chain includes RequireAuthorization
            stmt_end = content.find(";", match.end())
            if stmt_end == -1:
                stmt_end = min(len(content), match.end() + 500)
            group_stmt = content[match.start() : stmt_end]
            group_auth = ".RequireAuthorization()" in group_stmt
            group_prefixes[var_name] = (prefix, group_auth)

        # Step 2: Detect individual route mappings
        # Match any variable calling .MapGet/Post/Put/Delete/Patch
        minimal_api_pattern = re.compile(
            r'(\w+)\s*\.\s*Map(Get|Post|Put|Delete|Patch)\s*\(\s*["\']([^"\']*)["\']',
            re.MULTILINE,
        )

        for match in minimal_api_pattern.finditer(content):
            var_name = match.group(1)
            http_method = match.group(2).upper()
            path = match.group(3)

            # Resolve group prefix if the variable references a known group
            prefix = ""
            group_auth = False
            if var_name in group_prefixes:
                prefix, group_auth = group_prefixes[var_name]

            # Build full path from group prefix + route path
            if path and path != "/":
                full_path = prefix + "/" + path.lstrip("/")
            elif path == "/":
                full_path = prefix + "/"
            else:
                full_path = prefix if prefix else "/"

            # Normalize path params ({id} -> :id)
            full_path = self._normalize_aspnet_path(full_path)

            # Check for .RequireAuthorization() in the same statement
            stmt_end = content.find(";", match.end())
            if stmt_end == -1:
                stmt_end = min(len(content), match.end() + 300)
            route_stmt = content[match.start() : stmt_end]

            requires_auth = group_auth or ".RequireAuthorization()" in route_stmt

            routes.append(
                {
                    "path": full_path,
                    "methods": [http_method],
                    "file": str(file_path.relative_to(self.path)),
                    "framework": "ASP.NET Core",
                    "requires_auth": requires_auth,
                }
            )

        return routes

    def _detect_angular_routes(self) -> list[dict]:
        """Detect Angular routes from route configuration files."""
        routes = []
        ts_files = [
            f
            for f in self.path.glob("**/*.ts")
            if self._should_include_file(f)
            and not any(part in {"dist", "build"} for part in f.parts)
        ]

        for file_path in ts_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Check if this file contains Angular route definitions
            has_routes = bool(
                re.search(
                    r"(?:Routes|Route\[\])\s*=|RouterModule\.for(?:Root|Child)\s*\(",
                    content,
                )
            )
            if not has_routes:
                continue

            # Extract route objects from the content
            routes.extend(self._extract_angular_routes(file_path, content, prefix=""))

        return routes

    def _extract_angular_routes(
        self, file_path: Path, content: str, prefix: str
    ) -> list[dict]:
        """Extract route definitions from Angular route configuration."""
        routes = []

        # Find route objects by locating `{ path: '...'` and then tracking brace depth
        # to find the matching closing brace. This handles nested objects like
        # `data: { title: 'Home' }` that would break a simple [^}]* regex.
        path_pattern = re.compile(r"\{\s*path\s*:\s*['\"]([^'\"]*)['\"]")

        for match in path_pattern.finditer(content):
            path_segment = match.group(1)

            # Find the matching closing brace by counting brace depth
            brace_start = match.start()
            depth = 0
            pos = brace_start
            while pos < len(content):
                if content[pos] == "{":
                    depth += 1
                elif content[pos] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                pos += 1

            route_body = content[brace_start : pos + 1]

            # Build full path
            if path_segment:
                full_path = f"{prefix}/{path_segment}" if prefix else f"/{path_segment}"
            else:
                full_path = prefix if prefix else "/"

            # Normalize double slashes
            full_path = re.sub(r"//+", "/", full_path)

            # Convert Angular path params (:id is already the right format)
            # Ensure leading slash
            if full_path and not full_path.startswith("/"):
                full_path = "/" + full_path

            # Determine if route has a component/loadChildren/loadComponent
            has_target = bool(
                re.search(
                    r"(?:component|loadChildren|loadComponent)\s*:",
                    route_body,
                )
            )

            # Check for canActivate (auth guard)
            requires_auth = "canActivate" in route_body

            # Check for children in the route object
            has_children = "children" in route_body

            if has_target and not has_children:
                routes.append(
                    {
                        "path": full_path,
                        "methods": ["GET"],  # Frontend routes are GET
                        "file": str(file_path.relative_to(self.path)),
                        "framework": "Angular",
                        "requires_auth": requires_auth,
                    }
                )

            # If there are children, try to extract nested routes
            if has_children:
                # Find the children array content within this route object
                children_match = re.search(r"children\s*:\s*\[", route_body)
                if children_match:
                    # Compute absolute position in content
                    abs_bracket_start = brace_start + children_match.end()
                    # Find the matching closing bracket
                    bracket_depth = 1
                    bracket_pos = abs_bracket_start
                    while bracket_pos < len(content) and bracket_depth > 0:
                        if content[bracket_pos] == "[":
                            bracket_depth += 1
                        elif content[bracket_pos] == "]":
                            bracket_depth -= 1
                        bracket_pos += 1
                    children_content = content[abs_bracket_start : bracket_pos - 1]

                    # Recursively extract child routes
                    child_routes = self._extract_angular_routes(
                        file_path, children_content, prefix=full_path
                    )
                    routes.extend(child_routes)

        return routes
