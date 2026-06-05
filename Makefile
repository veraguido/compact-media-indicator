# Compact Media Indicator — build & install
#
# Common targets:
#   make            # compile the GSettings schema in-tree (alias of `schemas`)
#   make install    # compile schema and install into the user extensions dir
#   make enable     # enable the extension
#   make disable    # disable the extension
#   make prefs      # open the preferences window
#   make pack       # build a distributable zip (compact-media-indicator@local.zip)
#   make uninstall  # remove the installed copy
#   make clean      # remove build artifacts (compiled schema, zip)

UUID    := compact-media-indicator@local
SRC     := $(UUID)
DESTDIR := $(HOME)/.local/share/gnome-shell/extensions
DEST    := $(DESTDIR)/$(UUID)

# Files copied on install (everything the shell needs at runtime).
SOURCES := $(SRC)/metadata.json \
           $(SRC)/extension.js \
           $(SRC)/prefs.js \
           $(SRC)/mpris.js \
           $(SRC)/stylesheet.css \
           $(SRC)/schemas/org.gnome.shell.extensions.compact-media-indicator.gschema.xml

.PHONY: all schemas install uninstall enable disable prefs pack clean check help

all: schemas

## Compile the GSettings schema in the source tree.
schemas: $(SRC)/schemas/gschemas.compiled

$(SRC)/schemas/gschemas.compiled: $(SRC)/schemas/*.gschema.xml
	glib-compile-schemas --strict $(SRC)/schemas

## Install into the user extensions directory.
install: schemas
	@echo "==> Installing $(UUID) -> $(DEST)"
	rm -rf "$(DEST)"
	mkdir -p "$(DEST)/schemas"
	cp $(SRC)/metadata.json $(SRC)/extension.js $(SRC)/prefs.js \
	   $(SRC)/mpris.js $(SRC)/stylesheet.css "$(DEST)/"
	cp $(SRC)/schemas/*.gschema.xml $(SRC)/schemas/gschemas.compiled "$(DEST)/schemas/"
	@echo "==> Installed. Enable with: make enable"
	@echo "    On Wayland, log out and back in to load the new code."

## Remove the installed copy.
uninstall:
	rm -rf "$(DEST)"
	@echo "==> Removed $(DEST)"

## Enable / disable / open preferences via gnome-extensions.
enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

prefs:
	gnome-extensions prefs $(UUID)

## Build a distributable zip (also usable with `gnome-extensions install`).
pack: schemas
	@echo "==> Packing $(UUID).zip"
	rm -f $(UUID).zip
	cd $(SRC) && zip -r ../$(UUID).zip \
	    metadata.json extension.js prefs.js mpris.js stylesheet.css schemas
	@echo "==> Created $(UUID).zip"

## Quick JS syntax check (requires node; optional).
check:
	@command -v node >/dev/null 2>&1 \
	  && for f in $(SRC)/*.js; do node --check "$$f" && echo "  $$f OK"; done \
	  || echo "node not found; skipping JS syntax check"

clean:
	rm -f $(SRC)/schemas/gschemas.compiled $(UUID).zip

help:
	@echo "Targets: schemas install uninstall enable disable prefs pack check clean"
