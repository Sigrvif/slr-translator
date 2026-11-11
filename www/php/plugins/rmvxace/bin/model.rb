# model.rb — generic Ruby Marshal loading for RPG Maker XP/VX/VXAce data files.
#
# Marshal's class-path resolution on Ruby 2.6 does NOT invoke const_missing,
# so unknown classes cannot be stubbed lazily (verified empirically). Instead,
# the raw marshal bytes are prescanned for constant-path-like tokens (class
# names appear as symbols in the stream, e.g. "RPG::Actor") and stub classes
# are created BEFORE Marshal.load runs. False positives (random bytes inside
# compressed script blobs matching a constant-path shape) merely create unused
# stub classes — harmless.
#
# Marshal "userdef" (binary payload) classes are predefined with byte-exact
# passthrough: _load stores the raw payload, _dump returns it unchanged. Do
# NOT define _dump on the prescan stubs: Marshal.dump consults _dump whenever
# it exists, which would corrupt regular ivar-based objects. Known limitation:
# userdef classes beyond the predefined set (custom _dump classes seen only in
# modded games) are stubbed without _load and raise
# "TypeError: class X needs to have method '_load'".

module Model
  # Byte-preserving base for marshal userdef objects (Table, Color, Tone, Rect, Font).
  # The payload's ENCODING must be preserved as delivered by Marshal.load:
  # when the original _dump returned a non-binary string, the stream wraps the
  # userdef object in an "E" encoding ivar, Marshal.load surfaces that encoding
  # on the payload string handed to _load, and Marshal.dump re-emits the same
  # "E" wrapper iff _dump returns a non-binary string. Forcing binary here
  # would silently drop the wrapper and break byte-identical round-trips.
  class RawBlob
    def self._load(raw)
      obj = allocate
      obj.instance_variable_set(:@__payload, raw.dup)
      obj
    end

    def _dump(_depth = 0)
      @__payload
    end
  end

  USERDEF_CLASSES = %w[Table Color Tone Rect Font].freeze

  # Top-level constant names owned by this tool. The prescan must never stub
  # them as classes: sibling modules (Scripts, Rules, EventCodes) are declared
  # with `module` and would crash with TypeError if a class of the same name
  # already existed.
  RESERVED_NAMES = %w[Model Rules EventCodes Scripts].freeze

  # Creates (or reuses) the class for a constant path like "RPG::System::Terms".
  # Intermediate segments become plain classes so nested paths resolve.
  def self.define_stub_path(path)
    parts = path.split("::")
    parent = Object
    parts[0...-1].each do |seg|
      parent = if parent.const_defined?(seg, false)
        parent.const_get(seg)
      else
        klass = Class.new(Object)
        parent.const_set(seg.to_sym, klass)
        klass
      end
    end
    last = parts.last
    return if parent.const_defined?(last, false)
    parent.const_set(last.to_sym, Class.new(Object))
  end

  # True when a token is a single-segment (no "::") reserved top-level name;
  # namespaced tokens like "RPG::Scripts" are never reserved (they live under
  # RPG and cannot collide with this tool's top-level modules).
  def self.parts_reserved?(tok)
    return false if tok.include?("::")
    RESERVED_NAMES.include?(tok)
  end

  # Prescans marshal bytes for constant-path tokens and stubs them.
  def self.prepare!(bytes)
    USERDEF_CLASSES.each do |name|
      next if Object.const_defined?(name, false)
      Object.const_set(name, Class.new(RawBlob))
    end
    tokens = bytes.scan(/[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*/)
    tokens.each do |tok|
      next unless tok =~ /\A[A-Z]/
      next if parts_reserved?(tok)
      begin
        define_stub_path(tok.force_encoding("UTF-8"))
      rescue StandardError
        # token was not a usable constant path — ignore
      end
    end
  end

  def self.load(path)
    bytes = File.binread(path)
    prepare!(bytes)
    Marshal.load(bytes)
  end

  def self.load_bytes(bytes)
    prepare!(bytes)
    Marshal.load(bytes)
  end
end
