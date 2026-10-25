FROM ghcr.io/valhalla/valhalla-scripted@sha256:eaad372b8ef31e3e4592c442875aeb1375fbf5aeaa0d259b469e3b46583ab10d

COPY entrypoint.sh /usr/local/bin/farq-valhalla-entrypoint
RUN chmod 0755 /usr/local/bin/farq-valhalla-entrypoint

ENTRYPOINT ["/usr/local/bin/farq-valhalla-entrypoint"]
CMD ["build_tiles"]
