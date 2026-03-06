"""
Database Detector Module
========================

Detects database models and schemas across different ORMs:
- Python: SQLAlchemy, Django ORM
- JavaScript/TypeScript: Prisma, TypeORM, Drizzle, Mongoose
- C#/.NET: Entity Framework Core
"""

from __future__ import annotations

import re
from pathlib import Path

from .base import BaseAnalyzer


class DatabaseDetector(BaseAnalyzer):
    """Detects database models across multiple ORMs."""

    def __init__(self, path: Path):
        super().__init__(path)

    def detect_all_models(self) -> dict:
        """Detect all database models across different ORMs."""
        models = {}

        # Python SQLAlchemy
        models.update(self._detect_sqlalchemy_models())

        # Python Django
        models.update(self._detect_django_models())

        # Prisma schema
        models.update(self._detect_prisma_models())

        # TypeORM entities
        models.update(self._detect_typeorm_models())

        # Drizzle schema
        models.update(self._detect_drizzle_models())

        # Mongoose models
        models.update(self._detect_mongoose_models())

        # C#/.NET Entity Framework Core
        models.update(self._detect_ef_core_models())

        return models

    def _detect_sqlalchemy_models(self) -> dict:
        """Detect SQLAlchemy models."""
        models = {}
        py_files = list(self.path.glob("**/*.py"))

        for file_path in py_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Find class definitions that inherit from Base or db.Model
            class_pattern = (
                r"class\s+(\w+)\([^)]*(?:Base|db\.Model|DeclarativeBase)[^)]*\):"
            )
            matches = re.finditer(class_pattern, content)

            for match in matches:
                model_name = match.group(1)

                # Extract table name if defined
                table_match = re.search(r'__tablename__\s*=\s*["\'](\w+)["\']', content)
                table_name = (
                    table_match.group(1) if table_match else model_name.lower() + "s"
                )

                # Extract columns
                fields = {}
                column_pattern = r"(\w+)\s*=\s*Column\((.*?)\)"
                column_matches = re.finditer(
                    column_pattern, content[match.end() : match.end() + 2000]
                )

                for col_match in column_matches:
                    field_name = col_match.group(1)
                    field_def = col_match.group(2)

                    # Detect field properties
                    is_primary = "primary_key=True" in field_def
                    is_unique = "unique=True" in field_def
                    is_nullable = "nullable=False" not in field_def

                    # Extract type
                    type_match = re.search(
                        r"(Integer|String|Text|Boolean|DateTime|Float|JSON)", field_def
                    )
                    field_type = type_match.group(1) if type_match else "Unknown"

                    fields[field_name] = {
                        "type": field_type,
                        "primary_key": is_primary,
                        "unique": is_unique,
                        "nullable": is_nullable,
                    }

                if fields:  # Only add if we found fields
                    models[model_name] = {
                        "table": table_name,
                        "fields": fields,
                        "file": str(file_path.relative_to(self.path)),
                        "orm": "SQLAlchemy",
                    }

        return models

    def _detect_django_models(self) -> dict:
        """Detect Django models."""
        models = {}
        model_files = list(self.path.glob("**/models.py")) + list(
            self.path.glob("**/models/*.py")
        )

        for file_path in model_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Find class definitions that inherit from models.Model
            class_pattern = r"class\s+(\w+)\(models\.Model\):"
            matches = re.finditer(class_pattern, content)

            for match in matches:
                model_name = match.group(1)
                table_name = model_name.lower()

                # Extract fields
                fields = {}
                field_pattern = r"(\w+)\s*=\s*models\.(\w+Field)\((.*?)\)"
                field_matches = re.finditer(
                    field_pattern, content[match.end() : match.end() + 2000]
                )

                for field_match in field_matches:
                    field_name = field_match.group(1)
                    field_type = field_match.group(2)
                    field_args = field_match.group(3)

                    fields[field_name] = {
                        "type": field_type,
                        "unique": "unique=True" in field_args,
                        "nullable": "null=True" in field_args,
                    }

                if fields:
                    models[model_name] = {
                        "table": table_name,
                        "fields": fields,
                        "file": str(file_path.relative_to(self.path)),
                        "orm": "Django",
                    }

        return models

    def _detect_prisma_models(self) -> dict:
        """Detect Prisma models from schema.prisma."""
        models = {}
        schema_file = self.path / "prisma" / "schema.prisma"

        if not schema_file.exists():
            return models

        try:
            content = schema_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return models

        # Find model definitions
        model_pattern = r"model\s+(\w+)\s*\{([^}]+)\}"
        matches = re.finditer(model_pattern, content, re.MULTILINE)

        for match in matches:
            model_name = match.group(1)
            model_body = match.group(2)

            fields = {}
            # Parse fields: id Int @id @default(autoincrement())
            field_pattern = r"(\w+)\s+(\w+)([^/\n]*)"
            field_matches = re.finditer(field_pattern, model_body)

            for field_match in field_matches:
                field_name = field_match.group(1)
                field_type = field_match.group(2)
                field_attrs = field_match.group(3)

                fields[field_name] = {
                    "type": field_type,
                    "primary_key": "@id" in field_attrs,
                    "unique": "@unique" in field_attrs,
                    "nullable": "?" in field_type,
                }

            if fields:
                models[model_name] = {
                    "table": model_name.lower(),
                    "fields": fields,
                    "file": "prisma/schema.prisma",
                    "orm": "Prisma",
                }

        return models

    def _detect_typeorm_models(self) -> dict:
        """Detect TypeORM entities."""
        models = {}
        ts_files = list(self.path.glob("**/*.entity.ts")) + list(
            self.path.glob("**/entities/*.ts")
        )

        for file_path in ts_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Find @Entity() class declarations
            entity_pattern = r"@Entity\([^)]*\)\s*(?:export\s+)?class\s+(\w+)"
            matches = re.finditer(entity_pattern, content)

            for match in matches:
                model_name = match.group(1)

                # Extract columns
                fields = {}
                column_pattern = (
                    r"@(PrimaryGeneratedColumn|Column)\(([^)]*)\)\s+(\w+):\s*(\w+)"
                )
                column_matches = re.finditer(column_pattern, content)

                for col_match in column_matches:
                    decorator = col_match.group(1)
                    options = col_match.group(2)
                    field_name = col_match.group(3)
                    field_type = col_match.group(4)

                    fields[field_name] = {
                        "type": field_type,
                        "primary_key": decorator == "PrimaryGeneratedColumn",
                        "unique": "unique: true" in options,
                    }

                if fields:
                    models[model_name] = {
                        "table": model_name.lower(),
                        "fields": fields,
                        "file": str(file_path.relative_to(self.path)),
                        "orm": "TypeORM",
                    }

        return models

    def _detect_drizzle_models(self) -> dict:
        """Detect Drizzle ORM schemas."""
        models = {}
        schema_files = list(self.path.glob("**/schema.ts")) + list(
            self.path.glob("**/db/schema.ts")
        )

        for file_path in schema_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Find table definitions: export const users = pgTable('users', {...})
            table_pattern = r'export\s+const\s+(\w+)\s*=\s*(?:pg|mysql|sqlite)Table\(["\'](\w+)["\']'
            matches = re.finditer(table_pattern, content)

            for match in matches:
                const_name = match.group(1)
                table_name = match.group(2)

                models[const_name] = {
                    "table": table_name,
                    "fields": {},  # Would need more parsing for fields
                    "file": str(file_path.relative_to(self.path)),
                    "orm": "Drizzle",
                }

        return models

    def _detect_mongoose_models(self) -> dict:
        """Detect Mongoose models."""
        models = {}
        model_files = list(self.path.glob("**/models/*.js")) + list(
            self.path.glob("**/models/*.ts")
        )

        for file_path in model_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            # Find mongoose.model() or new Schema()
            model_pattern = r'mongoose\.model\(["\'](\w+)["\']'
            matches = re.finditer(model_pattern, content)

            for match in matches:
                model_name = match.group(1)

                models[model_name] = {
                    "table": model_name.lower(),
                    "fields": {},
                    "file": str(file_path.relative_to(self.path)),
                    "orm": "Mongoose",
                }

        return models

    def _detect_ef_core_models(self) -> dict:
        """Detect Entity Framework Core models."""
        models = {}

        # Directories to exclude from scanning
        excluded_dirs = {"bin", "obj", "node_modules", ".git", "TestResults"}

        cs_files = [
            f
            for f in self.path.glob("**/*.cs")
            if not any(part in excluded_dirs for part in f.parts)
        ]

        # Step 1: Find DbContext files and extract DbSet<T> declarations
        dbset_map = {}  # Maps entity type name -> DbSet property name (used as table name)
        dbcontext_pattern = re.compile(
            r"class\s+\w+\s*:\s*(?:Identity)?DbContext(?:<[^>]+>)?"
        )
        dbset_pattern = re.compile(r"DbSet<(\w+)>\s+(\w+)")

        for file_path in cs_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            if not dbcontext_pattern.search(content):
                continue

            for dbset_match in dbset_pattern.finditer(content):
                entity_type = dbset_match.group(1)
                property_name = dbset_match.group(2)
                dbset_map[entity_type] = property_name

        # Step 2: Collect entity names from IEntityTypeConfiguration<T>
        config_pattern = re.compile(r"IEntityTypeConfiguration<(\w+)>")
        configured_entities = set()

        for file_path in cs_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            for config_match in config_pattern.finditer(content):
                configured_entities.add(config_match.group(1))

        # Build the full set of known entity names
        known_entities = set(dbset_map.keys()) | configured_entities

        # Step 3: Scan .cs files for entity classes and extract properties
        table_attr_pattern = re.compile(r'\[Table\(["\'](\w+)["\']\)\]')
        class_pattern = re.compile(r"class\s+(\w+)")
        property_pattern = re.compile(
            r"public\s+(virtual\s+)?"
            r"([\w<>,?\[\]\s]+?)\s+"
            r"(\w+)\s*\{\s*get;\s*set;\s*\}"
        )
        key_attr_pattern = re.compile(r"\[Key\]")
        required_attr_pattern = re.compile(r"\[Required\]")
        maxlength_attr_pattern = re.compile(r"\[(?:MaxLength|StringLength)\((\d+)\)\]")
        column_attr_pattern = re.compile(r'\[Column\(["\'](\w+)["\']\)\]')

        # Navigation type prefixes to skip
        navigation_prefixes = (
            "ICollection<",
            "IList<",
            "IEnumerable<",
            "List<",
            "Collection<",
            "HashSet<",
        )

        # Known C# value/primitive types
        csharp_types = {
            "int",
            "long",
            "string",
            "bool",
            "DateTime",
            "DateTimeOffset",
            "Guid",
            "decimal",
            "double",
            "float",
            "byte[]",
            "short",
            "byte",
        }

        for file_path in cs_files:
            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            lines = content.split("\n")

            # Check for [Table] attribute at file level to find entity classes
            file_table_attrs = {}
            for i, line in enumerate(lines):
                table_match = table_attr_pattern.search(line)
                if table_match:
                    # The [Table] attribute applies to the next class definition
                    for j in range(i + 1, min(i + 5, len(lines))):
                        class_match = class_pattern.search(lines[j])
                        if class_match:
                            file_table_attrs[class_match.group(1)] = table_match.group(
                                1
                            )
                            break

            # Find all classes in this file
            class_matches = list(class_pattern.finditer(content))
            for idx, class_match in enumerate(class_matches):
                class_name = class_match.group(1)

                # Only process classes that are known entities or have [Table] attr
                is_known_entity = class_name in known_entities
                has_table_attr = class_name in file_table_attrs
                if not is_known_entity and not has_table_attr:
                    continue

                # Determine the region of this class body
                class_start = class_match.end()
                if idx + 1 < len(class_matches):
                    class_end = class_matches[idx + 1].start()
                else:
                    class_end = len(content)

                # Limit scanning to a reasonable size
                class_body = content[class_start : min(class_start + 5000, class_end)]
                class_lines = class_body.split("\n")

                # Extract properties
                fields = {}
                for line_idx, line in enumerate(class_lines):
                    prop_match = property_pattern.search(line)
                    if not prop_match:
                        continue

                    is_virtual = prop_match.group(1) is not None
                    raw_type = prop_match.group(2).strip()
                    prop_name = prop_match.group(3)

                    # Skip virtual navigation properties
                    if is_virtual:
                        continue

                    # Skip collection/navigation types
                    if any(
                        raw_type.startswith(prefix) for prefix in navigation_prefixes
                    ):
                        continue

                    # Determine if nullable (type ends with ?)
                    is_nullable = raw_type.endswith("?")
                    clean_type = raw_type.rstrip("?")

                    if not clean_type:
                        continue

                    # Only include properties with recognized types or common patterns
                    if clean_type not in csharp_types and (
                        not clean_type or not clean_type[0].isupper()
                    ):
                        continue

                    # Look at preceding lines for attributes
                    is_primary_key = False
                    is_required = False
                    max_length = None
                    column_name = None

                    # Check up to 4 lines above for attributes
                    attr_start = max(0, line_idx - 4)
                    attr_lines = "\n".join(class_lines[attr_start:line_idx])

                    if key_attr_pattern.search(attr_lines):
                        is_primary_key = True
                    if required_attr_pattern.search(attr_lines):
                        is_required = True
                    maxlen_match = maxlength_attr_pattern.search(attr_lines)
                    if maxlen_match:
                        max_length = int(maxlen_match.group(1))
                    col_match = column_attr_pattern.search(attr_lines)
                    if col_match:
                        column_name = col_match.group(1)

                    # Convention: property named "Id" or "<ClassName>Id" is primary key
                    if prop_name == "Id" or prop_name == f"{class_name}Id":
                        is_primary_key = True

                    field_info = {
                        "type": clean_type,
                        "primary_key": is_primary_key,
                        "unique": is_primary_key,
                        "nullable": is_nullable and not is_required,
                    }
                    if max_length is not None:
                        field_info["max_length"] = max_length
                    if column_name is not None:
                        field_info["column"] = column_name

                    fields[prop_name] = field_info

                if not fields:
                    continue

                # Determine table name
                if has_table_attr:
                    table_name = file_table_attrs[class_name]
                elif class_name in dbset_map:
                    table_name = dbset_map[class_name]
                else:
                    # Simple pluralization: append 's'
                    table_name = class_name + "s"

                models[class_name] = {
                    "table": table_name,
                    "fields": fields,
                    "file": str(file_path.relative_to(self.path)),
                    "orm": "Entity Framework",
                }

        return models
